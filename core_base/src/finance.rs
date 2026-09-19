//! Профили риска и стадии рыночного цикла.
//!
//! Общий модуль для всех финансовых приложений воркспейса.
//! Зависит только от `rust_decimal` + `serde` — без привязки к Tauri/IPC/БД.
//!
//! 5 профилей риска задают БАЗОВЫЕ целевые веса по классам активов.
//! Стадия рынка (фаза макроцикла + шоки) КОРРЕКТИРУЕТ эти веса.
//!
//! Логика ротации активов (для рынка РФ):
//! - Высокая ставка + удержание → Пик: флоатеры + LQDT, ОФЗ длинные избегать
//! - Высокая ставка + снижение → Восстановление: длинные ОФЗ (тело растёт)
//! - Низкая ставка + рост экономики → Расширение: акции роста
//! - Низкая ставка + инфляция растёт → Замедление: флоатеры + кэш
//!
//! Шоки (приоритет над обычной фазой):
//! - Война / глобальный обвал / банковский / валютный кризис → акции в 0,
//!   капитал в ликвидность, золото, флоатеры.
//! - Стагфляция / инфляционный шок → базовый потолок акций 5% (поправка по профилю),
//!   флоатеры + золото.
//! - Санкции (3 градации) → плавное сокращение акций пропорционально силе.

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

/// 5 профилей риска — от консервативного до ультра-агрессивного.
/// Это БАЗОВЫЕ веса, которые корректируются фазой рынка.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RiskProfile {
    Conservative,
    ModerateConservative,
    Balanced,
    ModerateAggressive,
    Aggressive,
}

impl RiskProfile {
    pub fn label(&self) -> &'static str {
        match self {
            RiskProfile::Conservative => "🛡️ Консервативный",
            RiskProfile::ModerateConservative => "🛡️ Умеренно-консервативный",
            RiskProfile::Balanced => "⚖️ Сбалансированный",
            RiskProfile::ModerateAggressive => "🚀 Умеренно-агрессивный",
            RiskProfile::Aggressive => "🚀 Агрессивный",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            RiskProfile::Conservative => "Защита капитала. Минимальный риск убытка.",
            RiskProfile::ModerateConservative => "Низкий риск. Стабильный рост.",
            RiskProfile::Balanced => "Баланс риска и доходности.",
            RiskProfile::ModerateAggressive => "Рост капитала с умеренным риском.",
            RiskProfile::Aggressive => "Максимальный рост. Высокая волатильность.",
        }
    }

    pub fn all() -> [RiskProfile; 5] {
        [
            RiskProfile::Conservative,
            RiskProfile::ModerateConservative,
            RiskProfile::Balanced,
            RiskProfile::ModerateAggressive,
            RiskProfile::Aggressive,
        ]
    }

    /// Базовые целевые веса: (акции, облигации, кэш/LQDT).
    pub fn base_weights(&self) -> (Decimal, Decimal, Decimal) {
        match self {
            RiskProfile::Conservative => (dec!(0.15), dec!(0.65), dec!(0.20)),
            RiskProfile::ModerateConservative => (dec!(0.30), dec!(0.55), dec!(0.15)),
            RiskProfile::Balanced => (dec!(0.45), dec!(0.40), dec!(0.15)),
            RiskProfile::ModerateAggressive => (dec!(0.60), dec!(0.30), dec!(0.10)),
            RiskProfile::Aggressive => (dec!(0.75), dec!(0.20), dec!(0.05)),
        }
    }

    /// Веса С УЧЁТОМ фазы рынка.
    ///
    /// Модель: шок задаёт БАЗОВЫЙ потолок акций для фазы (фиксированный, не зависит
    /// от профиля), а профиль корректирует его через множитель агрессивности:
    /// Conservative ×0.6, Balanced ×1.0, Aggressive ×1.6. Так и текст рекомендации
    /// («база 5%»), и расчёт совпадают, а риск-профиль даёт поправку ±.
    pub fn adjusted_weights(&self, phase: MarketPhase) -> (Decimal, Decimal, Decimal) {
        let (base_s, base_b, base_c) = self.base_weights();

        // Шоковые сценарии — приоритет.
        if let Some((base_cap, b_share)) = shock_allocation(phase) {
            // Профильная поправка к базовому потолку акций.
            let mult = self.aggressiveness_multiplier();
            // Не превышаем ни базовый потолок ×1.6 (агрессивный), ни исходную долю акций профиля.
            let stocks = (base_cap * mult).min(base_s).round_dp(4);
            // Остаток между облигациями и кэшем по доле b_share.
            let remainder = dec!(1) - stocks;
            let bonds = (remainder * b_share).round_dp(4);
            // Гарантируем сумму = 1 (компенсируем округление через кэш).
            let cash = dec!(1) - stocks - bonds;
            return (stocks, bonds, cash);
        }

        // Обычные фазы макроцикла.
        let (mut stocks, mut bonds, mut cash) = (base_s, base_b, base_c);
        match phase {
            MarketPhase::Peak => {
                bonds *= dec!(0.6);
                cash = (cash + dec!(0.15)).min(dec!(0.40));
                stocks = dec!(1) - bonds - cash;
            }
            MarketPhase::Recovery => {
                bonds = (bonds + dec!(0.10)).min(dec!(0.70));
                cash = (cash - dec!(0.10)).max(dec!(0.05));
                stocks = dec!(1) - bonds - cash;
            }
            MarketPhase::Expansion => {
                stocks = (stocks + dec!(0.10)).min(dec!(0.85));
                bonds *= dec!(0.7);
                cash = dec!(1) - stocks - bonds;
            }
            MarketPhase::Slowdown => {
                cash = (cash + dec!(0.05)).min(dec!(0.30));
                stocks = (stocks - dec!(0.05)).max(dec!(0.10));
                bonds = dec!(1) - stocks - cash;
            }
            MarketPhase::Unknown => {}
            // Шоки обработаны выше через shock_allocation.
            _ => {}
        }
        (stocks, bonds, cash)
    }

    /// Множитель агрессивности профиля для корректировки потолка акций в шоках.
    /// Conservative = 0.6 (режет базу), Balanced = 1.0, Aggressive = 1.6 (растит базу).
    fn aggressiveness_multiplier(&self) -> Decimal {
        match self {
            RiskProfile::Conservative => dec!(0.6),
            RiskProfile::ModerateConservative => dec!(0.8),
            RiskProfile::Balanced => dec!(1.0),
            RiskProfile::ModerateAggressive => dec!(1.3),
            RiskProfile::Aggressive => dec!(1.6),
        }
    }

    /// Комбинированные веса для НЕСКОЛЬКИХ выбранных шоков.
    ///
    /// `adjusted_weights` берёт аллокацию ОДНОЙ фазы (доминирующего шока) —
    /// при мультиселекте остальные выбранные сценарии игнорировались, и
    /// «рыночная ситуация» противоречила весам. Здесь: потолок акций =
    /// минимум по всем шокам (доминирует самый жёсткий), доля облигаций
    /// в остатке = среднее по шокам (честный компромисс).
    pub fn adjusted_weights_combined(&self, phases: &[MarketPhase]) -> (Decimal, Decimal, Decimal) {
        if phases.len() <= 1 {
            return self.adjusted_weights(phases.first().copied().unwrap_or(MarketPhase::Unknown));
        }
        let Some((min_cap, avg_b)) = combine_shock_allocation(phases) else {
            return self.adjusted_weights(MarketPhase::Unknown);
        };
        // Профильная поправка к базовому потолку акций — как в adjusted_weights.
        let mult = self.aggressiveness_multiplier();
        let base_s = self.base_weights().0;
        let stocks = (min_cap * mult).min(base_s).round_dp(4);
        let remainder = dec!(1) - stocks;
        let bonds = (remainder * avg_b).round_dp(4);
        let cash = dec!(1) - stocks - bonds;
        (stocks, bonds, cash)
    }
}

/// Распределение в шоковом сценарии.
/// Возвращает (БАЗОВЫЙ потолок акций для фазы, доля облигаций в остатке).
/// None — если это не шок (обычная фаза макроцикла).
///
/// Базовый потолок НЕ зависит от профиля — это ориентир из текста рекомендации.
/// Профильная поправка применяется в `adjusted_weights` через `aggressiveness_multiplier`.
fn shock_allocation(phase: MarketPhase) -> Option<(Decimal, Decimal)> {
    // (базовый потолок акций, доля облигаций в остатке 0..1)
    Some(match phase {
        // Война / глобальный обвал: акции в 0, остаток ~ флоатеры + кэш/золото/валюта.
        MarketPhase::War => (dec!(0), dec!(0.4)),
        MarketPhase::CrisisGlobal => (dec!(0), dec!(0.4)),
        MarketPhase::Crisis => (dec!(0), dec!(0.4)),
        // Банковский/кредитный кризис: ОФЗ — убежище, плюс кэш.
        MarketPhase::CrisisBanking => (dec!(0), dec!(0.55)),
        // Валютный кризис: валюта/золото (кэш-корзина), короткие флоатеры.
        MarketPhase::CrisisFx => (dec!(0), dec!(0.3)),
        // Инфляционный шок / стагфляция: база 5% защитных акций, флоатеры + золото.
        MarketPhase::CrisisInflation => (dec!(0.05), dec!(0.6)),
        MarketPhase::Stagflation => (dec!(0.05), dec!(0.6)),
        // Санкции по градации: лёгкие 15%, умеренные 10%, жёсткие 5% — потолок акций.
        MarketPhase::SanctionsLight => (dec!(0.15), dec!(0.65)),
        MarketPhase::SanctionsModerate => (dec!(0.10), dec!(0.60)),
        MarketPhase::SanctionsHard => (dec!(0.05), dec!(0.55)),
        _ => return None,
    })
}

/// Скомбинировать несколько шоков в одну фазу (для мультиселекта).
///
/// Правила комбинирования:
/// - **Акции**: берётся МИНИМУМ базовых потолков по всем выбранным шокам
///   (самый жёсткий шок доминирует по долям акций).
/// - **Доля облигаций**: среднее по выбранным шокам.
/// - **Рекомендации (preferred/avoid)**: объединение всех активов выбранных шоков.
/// - **Label/situation**: конкатенация меток выбранных шоков.
///
/// Если список пуст — возвращает `Unknown`. Если один — просто этот шок.
pub fn combine_shocks(phases: &[MarketPhase]) -> MarketPhase {
    if phases.is_empty() {
        return MarketPhase::Unknown;
    }
    if phases.len() == 1 {
        return phases[0];
    }
    // Для комбинированной фазы используем CrisisGlobal как «контейнер»,
    // но веса/тексты считаем отдельно через combine_shock_data().
    // Возвращает доминирующий шок (минимум по потолку акций) — его метка будет основной.
    //
    // При равном потолке акций решает порядок объявления вариантов (`Ord`), а не
    // порядок элементов во входном списке: у `War`, `Crisis` и `CrisisGlobal`
    // аллокации совпадают (0 акций), и раньше «побеждал» первый в списке —
    // один и тот же набор шоков давал разную фазу в зависимости от того, в каком
    // порядке пользователь выбрал их в настройках.
    // Обычная фаза макроцикла в роли шока = потолок акций 1 (самый мягкий), поэтому
    // шок всегда её вытесняет. Участвовать в сравнении она обязана: иначе при выборе
    // без шоков функция возвращала ПЕРВЫЙ элемент списка, и один и тот же набор фаз
    // давал разную метку в зависимости от порядка выбора.
    let cap_of = |p: MarketPhase| shock_allocation(p).map(|(c, _)| c).unwrap_or(dec!(1));
    let mut min_phase = phases[0];
    let mut min_cap = cap_of(phases[0]);
    for &p in &phases[1..] {
        let cap = cap_of(p);
        if cap < min_cap || (cap == min_cap && p < min_phase) {
            min_cap = cap;
            min_phase = p;
        }
    }
    min_phase
}

/// Данные комбинированного шока: потолок акций + доля облигаций в остатке.
/// Усредняет по выбранным шокам, но потолок акций = минимум (доминирует жёсткий).
pub fn combine_shock_allocation(phases: &[MarketPhase]) -> Option<(Decimal, Decimal)> {
    let allocations: Vec<(Decimal, Decimal)> =
        phases.iter().filter_map(|&p| shock_allocation(p)).collect();
    if allocations.is_empty() {
        return None;
    }
    // Потолок акций = минимум (самый жёсткий шок доминирует).
    let min_cap = allocations.iter().map(|(c, _)| *c).min().unwrap_or(dec!(0));
    // Доля облигаций = среднее по выбранным шокам.
    let avg_b = allocations.iter().map(|(_, b)| *b).sum::<Decimal>()
        / Decimal::from(allocations.len() as i64);
    Some((min_cap, avg_b.round_dp(4)))
}

/// Стадия рыночного цикла (фаза макроцикла + шоки).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum MarketPhase {
    /// Высокая ставка, удержание/рост. Флоатеры + LQDT.
    Peak,
    /// Высокая ставка, снижение. Длинные ОФЗ (тело растёт).
    Recovery,
    /// Низкая ставка, рост экономики. Акции роста.
    Expansion,
    /// Ставка растёт, инфляция. Замедление.
    Slowdown,
    /// Стагфляция: высокая инфляция + стагнация экономики.
    Stagflation,
    /// Кризис (generic, обратная совместимость). Эквивалентен глобальному обвалу.
    Crisis,
    /// Военные действия / геополитический конфликт.
    War,
    /// Санкции — лёгкие (точечные ограничения).
    SanctionsLight,
    /// Санкции — умеренные (секторальные пакеты).
    SanctionsModerate,
    /// Санкции — жёсткие (массовые, финансовая изоляция).
    SanctionsHard,
    /// Кризис — валютный (резкая девальвация рубля).
    CrisisFx,
    /// Кризис — кредитный/банковский (дефолты, проблемы эмитентов).
    CrisisBanking,
    /// Кризис — глобальный обвал рынков (системный, как 2008/2020).
    CrisisGlobal,
    /// Кризис — инфляционный шок (скачок цен).
    CrisisInflation,
    /// Недостаточно данных.
    Unknown,
}

impl MarketPhase {
    pub fn label(&self) -> &'static str {
        match self {
            MarketPhase::Peak => "🔴 Пик (высокая ставка)",
            MarketPhase::Recovery => "🟡 Восстановление (ставка снижается)",
            MarketPhase::Expansion => "🟢 Расширение (рост экономики)",
            MarketPhase::Slowdown => "🟠 Замедление (ставка растёт)",
            MarketPhase::Stagflation => "🟣 Стагфляция (инфляция + стагнация)",
            MarketPhase::Crisis => "⚫ Кризис (обвал рынка)",
            MarketPhase::War => "⚔️ Военные действия",
            MarketPhase::SanctionsLight => "🟦 Санкции — лёгкие",
            MarketPhase::SanctionsModerate => "🟧 Санкции — умеренные",
            MarketPhase::SanctionsHard => "🟥 Санкции — жёсткие",
            MarketPhase::CrisisFx => "💱 Валютный кризис (девальвация ₽)",
            MarketPhase::CrisisBanking => "🏦 Кредитный/банковский кризис",
            MarketPhase::CrisisGlobal => "🌐 Глобальный обвал рынков",
            MarketPhase::CrisisInflation => "🔥 Инфляционный шок",
            MarketPhase::Unknown => "⚪ Неопределённая",
        }
    }

    /// Краткое описание ситуации.
    pub fn situation(&self) -> &'static str {
        match self {
            MarketPhase::Peak => "Ставка ЦБ высокая (≥12%), удерживается или растёт.",
            MarketPhase::Recovery => "ЦБ начал цикл снижения ставки после пика.",
            MarketPhase::Expansion => "Ставка низкая (<8%), экономика растёт.",
            MarketPhase::Slowdown => "ЦБ повышает ставку, экономика замедляется.",
            MarketPhase::Stagflation => "Высокая инфляция при стагнации экономики.",
            MarketPhase::Crisis => "Панические распродажи, ликвидность важнее доходности.",
            MarketPhase::War => "Активные военные действия. Максимальный геополитический риск, неопределённость и паника.",
            MarketPhase::SanctionsLight => "Точечные санкции против отдельных компаний/секторов.",
            MarketPhase::SanctionsModerate => "Секторальные пакеты санкций, ограничения на технологии и финансы.",
            MarketPhase::SanctionsHard => "Массовые санкции, угроза финансовой изоляции, отключение от платёжных систем.",
            MarketPhase::CrisisFx => "Резкая девальвация рубля, бегство от рублёвых активов.",
            MarketPhase::CrisisBanking => "Дефолты эмитентов, проблемы банков, кризис доверия.",
            MarketPhase::CrisisGlobal => "Системный обвал всех рынков (аналог 2008, марта 2020).",
            MarketPhase::CrisisInflation => "Резкий скачок цен, инфляция выходит из-под контроля.",
            MarketPhase::Unknown => "Недостаточно данных для определения фазы.",
        }
    }

    /// Рекомендация — что покупать и почему.
    pub fn recommendation(&self) -> &'static str {
        match self {
            MarketPhase::Peak => {
                "ПРИОРИТЕТ: флоатеры ОФЗ (КС+спред, защита тела) и фонды ликвидности (LQDT, ≈КС−0.3%). \
                 ЧЕГО ИЗБЕГАТЬ: длинные ОФЗ с фикс. купоном — при удержании ставки их тело не растёт, \
                 а реальная доходность после инфляции низкая. \
                 АКЦИИ: только дивидендные «коровы» (Лукойл, Сбер) — стабильный денежный поток."
            }
            MarketPhase::Recovery => {
                "ПРИОРИТЕТ: длинные ОФЗ с фикс. купоном — тело растёт при снижении ставки \
                 (рост ≈ дюрация × Δставки; при дюрации 5 лет и −2% ставки тело +10%). \
                 ЧЕГО ИЗБЕГАТЬ: флоатеры — их купон снижается вместе со ставкой. \
                 АКЦИИ: начинать набирать недооценённые — впереди рост."
            }
            MarketPhase::Expansion => {
                "ПРИОРИТЕТ: акции роста (IT, потребительский сектор) — экономика на подъёме, \
                 прибыли компаний растут. \
                 ЧЕГО ИЗБЕГАТЬ: длинные ОФЗ — ставка уже низкая, доходность минимальна, \
                 потенциал роста тела исчерпан. Оставить только короткие для подушки. \
                 КЭШ: минимизировать — инфляция съедает."
            }
            MarketPhase::Slowdown => {
                "ПРИОРИТЕТ: флоатеры (купон растёт со ставкой) + LQDT (гибкость). \
                 ЧЕГО ИЗБЕГАТЬ: длинные ОФЗ — ставка растёт, тело падает. \
                 АКЦИИ: качественные компании с низкой долговой нагрузкой и стабильным спросом."
            }
            MarketPhase::Stagflation => {
                "СТАГФЛЯЦИЯ — цены растут, экономика стоит. \
                 ПРИОРИТЕТ: флоатеры ОФЗ (защита от инфляции через купон КС+спред), \
                 золото (XAUT/GLDUB) — традиционный хедж инфляции. \
                 АКЦИИ: защитные/экспортёры, базовый потолок 5% (поправка ± по риск-профилю). \
                 ЧЕГО ИЗБЕГАТЬ: длинные ОФЗ с фикс. купоном, акции cyclicals."
            }
            MarketPhase::Crisis => {
                "КРИЗИС (обвал) — выживание капитала важнее доходности. \
                 ПРИОРИТЕТ: LQDT и фонды ликвидности (мгновенный выход), \
                 короткие флоатеры, золото. АКЦИИ — НЕ рекомендуются. \
                 СТРАТЕГИЯ: переждать шторм в ликвидности, набирать активы на дне."
            }
            MarketPhase::War => {
                "ВОЕННЫЕ ДЕЙСТВИЯ — максимальный риск, капитал в защиту. \
                 ПРИОРИТЕТ: золото (XAUT, GLDUB) — главный хедж геополитики, \
                 наличная валюта (USD/EUR/CNY), короткие флоатеры ОФЗ, LQDT. \
                 АКЦИИ: убрать — биржа под ударом, просадки максимальны. \
                 ЧЕГО ИЗБЕГАТЬ: акции, длинные облигации, корпоративный долг, крипта. \
                 СТРАТЕГИЯ: сохранение ликвидности, набор активов после прояснения ситуации."
            }
            MarketPhase::SanctionsLight => {
                "ЛЕГКИЕ САНКЦИИ — точечное давление. \
                 ПРИОРИТЕТ: внутренние облигации (ОФЗ) и флоатеры, экспортёры (выручка в валюте). \
                 ЧЕГО ИЗБЕГАТЬ: компании из санкционных списков, зависимость от импорта. \
                 АКЦИИ: сократить на ~20% от базы, оставить устойчивые внутренние."
            }
            MarketPhase::SanctionsModerate => {
                "УМЕРЕННЫЕ САНКЦИИ — секторальные ограничения. \
                 ПРИОРИТЕТ: ОФЗ (гос. надёжность), золото, CNY (уход от USD/EUR-риска). \
                 АКЦИИ: не более 10%, только защищённые внутренние и экспортёры. \
                 ЧЕГО ИЗБЕГАТЬ: IT/технологии (зависимость от импорта), импортозависимые сектора."
            }
            MarketPhase::SanctionsHard => {
                "ЖЁСТКИЕ САНКЦИИ — угроза финансовой изоляции. \
                 ПРИОРИТЕТ: золото, наличные CNY/наличка, ОФЗ-флоатеры. \
                 АКЦИИ: не более 5%, только чистые экспортёры с замкнутым циклом. \
                 ЧЕГО ИЗБЕГАТЬ: активы под юрисдикцией недружественных стран, корп. облигации ниже AAA."
            }
            MarketPhase::CrisisFx => {
                "ВАЛЮТНЫЙ КРИЗИС — рубль резко слабеет. \
                 ПРИОРИТЕТ: наличная валюта (USD/EUR/CNY), золото (XAUT), замещающие bonds. \
                 АКЦИИ: убрать — рублёвые активы обесцениваются вместе с валютой. \
                 ЧЕГО ИЗБЕГАТЬ: длинные рублёвые ОФЗ, акции с рублёвой выручкой."
            }
            MarketPhase::CrisisBanking => {
                "КРЕДИТНЫЙ/БАНКОВСКИЙ КРИЗИС — дефолты эмитентов, кризис доверия. \
                 ПРИОРИТЕТ: ОФЗ (государственная надёжность — убежище), золото, LQDT. \
                 АКЦИИ: убрать — банковский сектор под ударом. \
                 ЧЕГО ИЗБЕГАТЬ: корпоративные облигации (особенно ниже AAA), акции финансовых компаний."
            }
            MarketPhase::CrisisGlobal => {
                "ГЛОБАЛЬНЫЙ ОБВАЛ — корреляция всех активов → 1, падает всё. \
                 ПРИОРИТЕТ: LQDT/кэш (мгновенный выход), короткие флоатеры, золото. \
                 АКЦИИ: убрать — распродажи по всем рынкам. \
                 СТРАТЕГИЯ: максимальная ликвидность, покупка на панике."
            }
            MarketPhase::CrisisInflation => {
                "ИНФЛЯЦИОННЫЙ ШОК — цены взлетают. \
                 ПРИОРИТЕТ: флоатеры (купон следует за ставкой/инфляцией), золото, товары. \
                 АКЦИИ: защитные, базовый потолок 5% (поправка ± по риск-профилю). \
                 ЧЕГО ИЗБЕГАТЬ: длинные ОФЗ с фикс. купоном — инфляция съедает тело."
            }
            MarketPhase::Unknown => {
                "Ставка в среднем диапазоне (8–12%) без явного тренда: \
                 сигналов для ротации нет — придерживайтесь базового профиля."
            }
        }
    }

    /// Предпочтительные активы в фазе (от сильных к слабым).
    pub fn preferred_assets(&self) -> &'static [&'static str] {
        match self {
            MarketPhase::Peak => &[
                "Флоатеры ОФЗ (КС+спред)",
                "LQDT / фонды ликвидности",
                "Короткие ОФЗ (до 1 года)",
                "Дивидендные акции (Лукойл, Сбер)",
            ],
            MarketPhase::Recovery => &[
                "Длинные ОФЗ с фикс. купоном",
                "Акции (недооценённые на дне)",
                "Корп. облигации AAA",
            ],
            MarketPhase::Expansion => &[
                "Акции роста (IT, потребительский)",
                "Корп. облигации (рост прибылей)",
                "Короткие ОФЗ (подушка)",
            ],
            MarketPhase::Slowdown => &[
                "Флоатеры (купон растёт)",
                "LQDT",
                "Защитные акции (здоровье, ритейл)",
            ],
            MarketPhase::Stagflation => {
                &["Флоатеры ОФЗ (КС+спред)", "Золото (XAUT, GLDUB)", "LQDT"]
            }
            MarketPhase::Crisis => &["LQDT / кэш", "Короткие флоатеры", "Золото"],
            MarketPhase::War => &[
                "Золото (XAUT, GLDUB)",
                "Наличная валюта (USD/EUR/CNY)",
                "Короткие флоатеры ОФЗ",
                "LQDT",
            ],
            MarketPhase::SanctionsLight => &[
                "ОФЗ и флоатеры (внутренний долг)",
                "Акции экспортёров (валютная выручка)",
                "Золото",
            ],
            MarketPhase::SanctionsModerate => &[
                "ОФЗ (гос. надёжность)",
                "Золото (XAUT, GLDUB)",
                "CNY / юань-облигации",
                "Акции защищённых экспортёров",
            ],
            MarketPhase::SanctionsHard => &["Золото (XAUT, GLDUB)", "Наличные CNY", "ОФЗ-флоатеры"],
            MarketPhase::CrisisFx => &[
                "Наличная валюта (USD/EUR/CNY)",
                "Золото (XAUT)",
                "Замещающие облигации",
            ],
            MarketPhase::CrisisBanking => &["ОФЗ (государственное убежище)", "Золото", "LQDT"],
            MarketPhase::CrisisGlobal => &["LQDT / кэш", "Короткие флоатеры", "Золото"],
            MarketPhase::CrisisInflation => &[
                "Флоатеры (купон за инфляцией)",
                "Золото (XAUT, GLDUB)",
                "Товары/сырьё",
            ],
            MarketPhase::Unknown => &[],
        }
    }

    /// Чего избегать в фазе.
    pub fn avoid_assets(&self) -> &'static [&'static str] {
        match self {
            MarketPhase::Peak => &[
                "Длинные ОФЗ (фикс. купон)",
                "Акции роста (высокая ставка давит)",
            ],
            MarketPhase::Recovery => &["Флоатеры (купон снижается)", "LQDT (доходность падает)"],
            MarketPhase::Expansion => &["Длинные ОФЗ (доходность минимальна)", "Избыток кэша"],
            MarketPhase::Slowdown => &["Длинные ОФЗ (тело падает)", "Акции cyclicals"],
            MarketPhase::Stagflation => &[
                "Длинные ОФЗ",
                "Корп. облигации низкого рейтинга",
                "Акции cyclicals",
            ],
            MarketPhase::Crisis => &["Акции", "Длинные облигации", "Корпоративный долг", "Крипта"],
            MarketPhase::War => &[
                "Акции (биржа под ударом)",
                "Длинные облигации",
                "Корпоративный долг",
                "Крипта",
            ],
            MarketPhase::SanctionsLight => &[
                "Компании из санкционных списков",
                "Импортозависимые бизнесы",
            ],
            MarketPhase::SanctionsModerate => &[
                "IT / технологии (импортозависимость)",
                "Импортозависимые сектора",
                "Активы в недружественных юрисдикциях",
            ],
            MarketPhase::SanctionsHard => &[
                "Активы под недружественной юрисдикцией",
                "Корп. облигации ниже AAA",
                "IT / высокотехнологичные акции",
            ],
            MarketPhase::CrisisFx => &[
                "Длинные рублёвые ОФЗ",
                "Акции с рублёвой выручкой",
                "Рублёвые депозиты (long)",
            ],
            MarketPhase::CrisisBanking => &[
                "Корп. облигации (особенно ниже AAA)",
                "Акции финансовых компаний",
                "Длинные облигации",
            ],
            MarketPhase::CrisisGlobal => {
                &["Акции", "Длинные облигации", "Корпоративный долг", "Крипта"]
            }
            MarketPhase::CrisisInflation => &[
                "Длинные ОФЗ (фикс. купон)",
                "Кэш (инфляция съедает)",
                "Облигации низкой доходности",
            ],
            MarketPhase::Unknown => &[],
        }
    }
}

/// Распознать строку шока в MarketPhase. None — шока нет.
fn parse_shock(shock: &str) -> Option<MarketPhase> {
    match shock {
        "none" | "" => None,
        "crisis" => Some(MarketPhase::Crisis),
        "crisis_global" => Some(MarketPhase::CrisisGlobal),
        "crisis_fx" => Some(MarketPhase::CrisisFx),
        "crisis_banking" => Some(MarketPhase::CrisisBanking),
        "crisis_inflation" => Some(MarketPhase::CrisisInflation),
        "stagflation" => Some(MarketPhase::Stagflation),
        "war" => Some(MarketPhase::War),
        "sanctions_light" => Some(MarketPhase::SanctionsLight),
        "sanctions_moderate" => Some(MarketPhase::SanctionsModerate),
        "sanctions_hard" => Some(MarketPhase::SanctionsHard),
        _ => None,
    }
}

/// Является ли строка известным шоком (для валидации на фронте).
pub fn is_known_shock(shock: &str) -> bool {
    matches!(
        shock,
        "none"
            | "crisis"
            | "crisis_global"
            | "crisis_fx"
            | "crisis_banking"
            | "crisis_inflation"
            | "stagflation"
            | "war"
            | "sanctions_light"
            | "sanctions_moderate"
            | "sanctions_hard"
    )
}

/// Определить стадию рынка.
///
/// Параметры:
/// - `key_rate` — ключевая ставка ЦБ (%).
/// - `trend` — "up" / "down" / "flat".
/// - `shock` — рыночный шок: "none" / "war" / "sanctions_*" / "crisis*" / "stagflation".
///
/// Шок перекрывает обычную фазу — если есть кризис или война, это важнее ставки.
pub fn detect_market_phase(key_rate: Decimal, trend: &str, shock: &str) -> MarketPhase {
    // Шоки рынка — приоритет над обычным циклом.
    if let Some(phase) = parse_shock(shock) {
        return phase;
    }
    // Пороги «высокой»/«низкой» ставки. Ранее (16/10) между ними была
    // «мёртвая зона» 10–16%: при ставке 12% и тренде «flat» фаза выпадала
    // в Unknown, хотя пользователь задал все параметры. Сдвиг до 12/8
    // сужает эту зону до 8–12% (нейтральный диапазон, где действительно
    // нет однозначного сигнала).
    let high_threshold = dec!(12);
    let low_threshold = dec!(8);

    match trend {
        "up" => {
            if key_rate >= high_threshold {
                MarketPhase::Peak
            } else {
                MarketPhase::Slowdown
            }
        }
        "down" => {
            if key_rate >= high_threshold {
                MarketPhase::Recovery
            } else {
                MarketPhase::Expansion
            }
        }
        _ => {
            // flat
            if key_rate >= high_threshold {
                MarketPhase::Peak
            } else if key_rate <= low_threshold {
                MarketPhase::Expansion
            } else {
                MarketPhase::Unknown
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_have_5_levels() {
        assert_eq!(RiskProfile::all().len(), 5);
    }

    #[test]
    fn base_weights_sum_to_1() {
        for p in RiskProfile::all() {
            let (s, b, c) = p.base_weights();
            assert_eq!(s + b + c, dec!(1));
        }
    }

    #[test]
    fn adjusted_weights_sum_to_1() {
        // Веса после корректировки фазой должны суммироваться в 1.
        let all_phases = [
            MarketPhase::Peak,
            MarketPhase::Recovery,
            MarketPhase::Expansion,
            MarketPhase::Slowdown,
            MarketPhase::Stagflation,
            MarketPhase::Crisis,
            MarketPhase::War,
            MarketPhase::SanctionsLight,
            MarketPhase::SanctionsModerate,
            MarketPhase::SanctionsHard,
            MarketPhase::CrisisFx,
            MarketPhase::CrisisBanking,
            MarketPhase::CrisisGlobal,
            MarketPhase::CrisisInflation,
            MarketPhase::Unknown,
        ];
        for p in RiskProfile::all() {
            for phase in all_phases {
                let (s, b, c) = p.adjusted_weights(phase);
                let sum = (s + b + c).round_dp(4);
                assert!(
                    (sum - dec!(1)).abs() < dec!(0.02),
                    "Профиль {:?} + фаза {:?}: сумма {} (ожидалась 1.0)",
                    p,
                    phase,
                    sum
                );
            }
        }
    }

    #[test]
    fn combined_shocks_weights_sum_to_1_and_honor_min_cap() {
        // Мультиселект шоков: веса суммируются в 1, потолок акций = минимум
        // по шокам (жёсткий доминирует), а не берётся у одного «победителя».
        let combos = [
            vec![MarketPhase::War, MarketPhase::SanctionsLight],
            vec![MarketPhase::CrisisInflation, MarketPhase::SanctionsModerate],
            vec![
                MarketPhase::CrisisBanking,
                MarketPhase::War,
                MarketPhase::CrisisFx,
            ],
        ];
        for p in RiskProfile::all() {
            for phases in &combos {
                let (s, b, c) = p.adjusted_weights_combined(phases);
                let sum = (s + b + c).round_dp(4);
                assert!(
                    (sum - dec!(1)).abs() < dec!(0.02),
                    "Профиль {:?} + шоки {:?}: сумма {}",
                    p,
                    phases,
                    sum
                );
                // Потолок акций ≤ потолка самого жёсткого шока (×множитель профиля).
                let min_cap = combine_shock_allocation(phases).unwrap().0;
                let mult = match p {
                    RiskProfile::Conservative => dec!(0.6),
                    RiskProfile::ModerateConservative => dec!(0.8),
                    RiskProfile::Balanced => dec!(1.0),
                    RiskProfile::ModerateAggressive => dec!(1.3),
                    RiskProfile::Aggressive => dec!(1.6),
                };
                assert!(
                    s <= (min_cap * mult).round_dp(4) + dec!(0.001),
                    "Профиль {:?}: акции {} > потолка {:.2}",
                    p,
                    s,
                    min_cap * mult
                );
            }
        }
    }

    /// Ключевое исправление: в кризисе/войне/обвале акции должны быть ~0.
    #[test]
    fn hard_shocks_zero_stocks() {
        let hard_shocks = [
            MarketPhase::Crisis,
            MarketPhase::CrisisGlobal,
            MarketPhase::CrisisBanking,
            MarketPhase::CrisisFx,
            MarketPhase::War,
        ];
        for p in RiskProfile::all() {
            for phase in hard_shocks {
                let (s, _, _) = p.adjusted_weights(phase);
                assert!(
                    s <= dec!(0.005),
                    "Профиль {:?} + фаза {:?}: акции {} должны быть ~0",
                    p,
                    phase,
                    s
                );
            }
        }
    }

    /// В стагфляции/инфляции базовый потолок акций = 5%, с поправкой по профилю:
    /// Conservative ×0.6 → 3%, Balanced ×1.0 → 5%, Aggressive ×1.6 → 8%.
    /// При этом не превышает базовую долю акций профиля.
    #[test]
    fn inflation_shocks_base_5pct_with_profile_adjust() {
        // Conservative (base_s=0.15): min(0.05×0.6, 0.15) = 0.03
        let (s, _, _) = RiskProfile::Conservative.adjusted_weights(MarketPhase::CrisisInflation);
        assert_eq!(
            s,
            dec!(0.03),
            "Conservative + инфляция: акции должны быть 3%"
        );
        // Balanced (base_s=0.45): min(0.05×1.0, 0.45) = 0.05
        let (s, _, _) = RiskProfile::Balanced.adjusted_weights(MarketPhase::CrisisInflation);
        assert_eq!(
            s,
            dec!(0.05),
            "Balanced + инфляция: акции должны быть 5% (база)"
        );
        // Aggressive (base_s=0.75): min(0.05×1.6, 0.75) = 0.08
        let (s, _, _) = RiskProfile::Aggressive.adjusted_weights(MarketPhase::CrisisInflation);
        assert_eq!(s, dec!(0.08), "Aggressive + инфляция: акции должны быть 8%");
        // Та же логика для стагфляции.
        let (s, _, _) = RiskProfile::Balanced.adjusted_weights(MarketPhase::Stagflation);
        assert_eq!(s, dec!(0.05), "Balanced + стагфляция: акции = 5%");
    }

    /// Новая модель: профиль корректирует базовый потолок шока.
    /// Агрессивный держит больше акций в шоке, чем консервативный.
    #[test]
    fn aggressive_keeps_more_stocks_in_shock_than_conservative() {
        for phase in [
            MarketPhase::Stagflation,
            MarketPhase::CrisisInflation,
            MarketPhase::SanctionsModerate,
            MarketPhase::SanctionsHard,
        ] {
            let (cons, _, _) = RiskProfile::Conservative.adjusted_weights(phase);
            let (agg, _, _) = RiskProfile::Aggressive.adjusted_weights(phase);
            assert!(
                agg >= cons,
                "Фаза {:?}: Aggressive {} должен быть ≥ Conservative {}",
                phase,
                agg,
                cons
            );
        }
    }

    /// Санкции режут акции тем сильнее, чем жёстче пакет (база 15% > 10% > 5%).
    /// Для Balanced (множитель 1.0, base_s=0.45) итог: 0.15 / 0.10 / 0.05.
    #[test]
    fn sanctions_gradation_reduces_stocks_monotonically() {
        let p = RiskProfile::Balanced;
        let light = p.adjusted_weights(MarketPhase::SanctionsLight).0;
        let moderate = p.adjusted_weights(MarketPhase::SanctionsModerate).0;
        let hard = p.adjusted_weights(MarketPhase::SanctionsHard).0;
        assert_eq!(light, dec!(0.15), "Balanced + лёгкие санкции = 15%");
        assert_eq!(moderate, dec!(0.10), "Balanced + умеренные санкции = 10%");
        assert_eq!(hard, dec!(0.05), "Balanced + жёсткие санкции = 5%");
        assert!(light > moderate, "light {} > moderate {}", light, moderate);
        assert!(moderate > hard, "moderate {} > hard {}", moderate, hard);
    }

    /// Комбинирование шоков: минимум по потолку акций доминирует.
    #[test]
    fn combine_shocks_takes_min_stocks_cap() {
        // Инфляция (база 5%) + жёсткие санкции (база 5%) → 5%.
        let alloc =
            combine_shock_allocation(&[MarketPhase::CrisisInflation, MarketPhase::SanctionsHard]);
        assert_eq!(alloc.unwrap().0, dec!(0.05));

        // Лёгкие санкции (15%) + война (0%) → 0% (война доминирует).
        let alloc = combine_shock_allocation(&[MarketPhase::SanctionsLight, MarketPhase::War]);
        assert_eq!(alloc.unwrap().0, dec!(0));
    }

    /// Комбинирование: пустой список → Unknown, один → он сам.
    /// Порядок шоков во входном списке не должен менять результат: один и тот же
    /// набор обязан давать одну фазу. Регрессия: у War/Crisis/CrisisGlobal
    /// аллокации совпадают, и при равном потолке акций побеждал первый элемент
    /// списка — [crisis_global, war] давало CrisisGlobal, а [war, crisis_global] — War.
    #[test]
    fn combine_shocks_is_order_independent() {
        let a = combine_shocks(&[MarketPhase::CrisisGlobal, MarketPhase::War]);
        let b = combine_shocks(&[MarketPhase::War, MarketPhase::CrisisGlobal]);
        assert_eq!(a, b, "порядок шоков не должен влиять на фазу");

        let c = combine_shocks(&[
            MarketPhase::SanctionsHard,
            MarketPhase::CrisisFx,
            MarketPhase::War,
        ]);
        let d = combine_shocks(&[
            MarketPhase::War,
            MarketPhase::SanctionsHard,
            MarketPhase::CrisisFx,
        ]);
        assert_eq!(c, d, "порядок шоков не должен влиять на фазу (три шока)");
    }

    #[test]
    fn combine_shocks_edge_cases() {
        assert_eq!(combine_shocks(&[]), MarketPhase::Unknown);
        assert_eq!(combine_shocks(&[MarketPhase::War]), MarketPhase::War);
    }

    #[test]
    fn crisis_reduces_stocks() {
        let (base_s, _, _) = RiskProfile::Balanced.base_weights();
        let (crisis_s, _, _) = RiskProfile::Balanced.adjusted_weights(MarketPhase::Crisis);
        assert!(crisis_s < base_s, "Кризис должен сокращать акции");
    }

    #[test]
    fn crisis_increases_cash() {
        let (_, _, base_c) = RiskProfile::Balanced.base_weights();
        let (_, _, crisis_c) = RiskProfile::Balanced.adjusted_weights(MarketPhase::Crisis);
        assert!(crisis_c > base_c, "Кризис должен увеличивать кэш");
    }

    #[test]
    fn expansion_has_more_stocks_than_bonds() {
        let (s, b, _) = RiskProfile::Balanced.adjusted_weights(MarketPhase::Expansion);
        assert!(
            s > b,
            "Расширение: акции {} должны быть > облигаций {}",
            s,
            b
        );
    }

    #[test]
    fn expansion_does_not_recommend_long_bonds() {
        let preferred = MarketPhase::Expansion.preferred_assets();
        let has_long_ofz = preferred.iter().any(|a| a.contains("Длинные"));
        assert!(
            !has_long_ofz,
            "В расширении длинные ОФЗ не должны быть в приоритете"
        );
    }

    #[test]
    fn recovery_recommends_long_bonds() {
        let preferred = MarketPhase::Recovery.preferred_assets();
        let has_long_ofz = preferred.iter().any(|a| a.contains("Длинные"));
        assert!(
            has_long_ofz,
            "В восстановлении длинные ОФЗ должны быть в приоритете"
        );
    }

    #[test]
    fn war_does_not_recommend_stocks() {
        // В войне акции не должны быть в preferred.
        let preferred = MarketPhase::War.preferred_assets();
        assert!(
            !preferred.iter().any(|a| a.contains("Акции")),
            "В войне акции не должны быть в приоритете"
        );
    }

    #[test]
    fn shock_overrides_phase() {
        assert_eq!(
            detect_market_phase(dec!(8), "up", "crisis"),
            MarketPhase::Crisis
        );
        assert_eq!(
            detect_market_phase(dec!(21), "down", "stagflation"),
            MarketPhase::Stagflation
        );
        assert_eq!(detect_market_phase(dec!(21), "up", "war"), MarketPhase::War);
        assert_eq!(
            detect_market_phase(dec!(5), "flat", "crisis_fx"),
            MarketPhase::CrisisFx
        );
    }

    #[test]
    fn phase_detection() {
        assert_eq!(
            detect_market_phase(dec!(21), "flat", "none"),
            MarketPhase::Peak
        );
        assert_eq!(
            detect_market_phase(dec!(18), "down", "none"),
            MarketPhase::Recovery
        );
        assert_eq!(
            detect_market_phase(dec!(8), "flat", "none"),
            MarketPhase::Expansion
        );
    }

    /// После сдвига порогов (16→12, 10→8) «мёртвая зона» сузилась до 8–12%.
    /// Ставка 12% при flat — уже Пик, 8% — Расширение, а вот 8–12% — честный Unknown.
    #[test]
    fn threshold_boundaries() {
        // Верхняя граница: 12% и выше — высокая ставка.
        assert_eq!(
            detect_market_phase(dec!(12), "flat", "none"),
            MarketPhase::Peak
        );
        assert_eq!(
            detect_market_phase(dec!(12), "down", "none"),
            MarketPhase::Recovery
        );
        // Нижняя граница: 8% и ниже — низкая ставка.
        assert_eq!(
            detect_market_phase(dec!(8), "flat", "none"),
            MarketPhase::Expansion
        );
        assert_eq!(
            detect_market_phase(dec!(8), "down", "none"),
            MarketPhase::Expansion
        );
        // Нейтральная зона 8–12% при flat — Unknown с внятной рекомендацией.
        assert_eq!(
            detect_market_phase(dec!(10), "flat", "none"),
            MarketPhase::Unknown
        );
        assert_eq!(
            detect_market_phase(dec!(9), "flat", "none"),
            MarketPhase::Unknown
        );
    }

    #[test]
    fn unknown_recommendation_is_guidance_not_error() {
        // Раньше текст просил «задать ставку и тренд», хотя они уже заданы —
        // вводило в заблуждение. Теперь это нейтральная рекомендация.
        let rec = MarketPhase::Unknown.recommendation();
        assert!(rec.contains("базового профиля"), "рекомендация: {rec}");
        assert!(!rec.contains("Задайте ставку"), "рекомендация: {rec}");
    }

    #[test]
    fn parse_all_shock_strings() {
        for s in [
            "none",
            "crisis",
            "crisis_global",
            "crisis_fx",
            "crisis_banking",
            "crisis_inflation",
            "stagflation",
            "war",
            "sanctions_light",
            "sanctions_moderate",
            "sanctions_hard",
        ] {
            assert!(is_known_shock(s), "должен знать шок {s}");
        }
        assert!(!is_known_shock("unknown_shock"));
    }
}

/// Свойство-тесты на денежную математику: перебираются ВСЕ комбинации фаз
/// (пространство маленькое — 15 фаз, пары и тройки), а не случайная выборка:
/// так проверка детерминирована и не даёт «зелено, потому что повезло».
#[cfg(test)]
mod invariants {
    use super::*;

    const ALL_PHASES: [MarketPhase; 15] = [
        MarketPhase::Peak,
        MarketPhase::Recovery,
        MarketPhase::Expansion,
        MarketPhase::Slowdown,
        MarketPhase::Stagflation,
        MarketPhase::Crisis,
        MarketPhase::War,
        MarketPhase::SanctionsLight,
        MarketPhase::SanctionsModerate,
        MarketPhase::SanctionsHard,
        MarketPhase::CrisisFx,
        MarketPhase::CrisisBanking,
        MarketPhase::CrisisGlobal,
        MarketPhase::CrisisInflation,
        MarketPhase::Unknown,
    ];

    /// Допуск на округление: веса считаются с `round_dp(4)`.
    const EPS: Decimal = dec!(0.0001);

    fn check_weights(profile: RiskProfile, phases: &[MarketPhase]) {
        let (stocks, bonds, cash) = profile.adjusted_weights_combined(phases);
        let sum = stocks + bonds + cash;
        assert!(
            (sum - dec!(1)).abs() <= EPS,
            "{} {:?}: сумма весов {sum} ≠ 1 ({stocks}/{bonds}/{cash})",
            profile.label(),
            phases.iter().map(|p| p.label()).collect::<Vec<_>>()
        );
        for (name, value) in [("акции", stocks), ("облигации", bonds), ("кэш", cash)]
        {
            assert!(
                value >= dec!(0) && value <= dec!(1),
                "{} {:?}: доля «{name}» вне 0..1: {value}",
                profile.label(),
                phases.iter().map(|p| p.label()).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn weights_stay_normalised_for_every_phase() {
        for profile in RiskProfile::all() {
            for &phase in &ALL_PHASES {
                check_weights(profile, &[phase]);
            }
        }
    }

    #[test]
    fn weights_stay_normalised_for_every_pair_and_triple() {
        for profile in RiskProfile::all() {
            for &a in &ALL_PHASES {
                for &b in &ALL_PHASES {
                    check_weights(profile, &[a, b]);
                    for &c in &ALL_PHASES {
                        check_weights(profile, &[a, b, c]);
                    }
                }
            }
        }
    }

    #[test]
    fn single_phase_combination_equals_adjusted_weights() {
        for profile in RiskProfile::all() {
            for &phase in &ALL_PHASES {
                assert_eq!(
                    profile.adjusted_weights_combined(&[phase]),
                    profile.adjusted_weights(phase),
                    "{} {}",
                    profile.label(),
                    phase.label()
                );
                // Пустой список — как «фаза неизвестна», а не паника.
                assert_eq!(
                    profile.adjusted_weights_combined(&[]),
                    profile.adjusted_weights(MarketPhase::Unknown),
                    "{} пустой список",
                    profile.label()
                );
            }
        }
    }

    #[test]
    fn combination_is_order_independent() {
        for &a in &ALL_PHASES {
            for &b in &ALL_PHASES {
                assert_eq!(
                    combine_shocks(&[a, b]),
                    combine_shocks(&[b, a]),
                    "{a:?} {b:?}"
                );
                assert_eq!(
                    combine_shock_allocation(&[a, b]),
                    combine_shock_allocation(&[b, a]),
                    "{a:?} {b:?}"
                );
                for profile in RiskProfile::all() {
                    assert_eq!(
                        profile.adjusted_weights_combined(&[a, b]),
                        profile.adjusted_weights_combined(&[b, a]),
                        "{} {a:?} {b:?}",
                        profile.label()
                    );
                    for &c in &ALL_PHASES {
                        let abc = profile.adjusted_weights_combined(&[a, b, c]);
                        let cba = profile.adjusted_weights_combined(&[c, b, a]);
                        assert_eq!(abc, cba, "{} {a:?} {b:?} {c:?}", profile.label());
                    }
                }
            }
        }
    }

    #[test]
    fn combination_picks_one_of_the_selected_phases() {
        assert_eq!(combine_shocks(&[]), MarketPhase::Unknown);
        for &a in &ALL_PHASES {
            assert_eq!(combine_shocks(&[a]), a);
            for &b in &ALL_PHASES {
                let dominant = combine_shocks(&[a, b]);
                assert!(
                    dominant == a || dominant == b,
                    "доминирующая фаза {dominant:?} не из выбранных: {a:?}, {b:?}"
                );
            }
        }
    }

    #[test]
    fn shock_cap_is_the_strictest_of_the_selected() {
        for &a in &ALL_PHASES {
            for &b in &ALL_PHASES {
                let single_a = shock_allocation(a);
                let single_b = shock_allocation(b);
                let combined = combine_shock_allocation(&[a, b]);
                match (single_a, single_b) {
                    (None, None) => assert!(combined.is_none(), "{a:?} {b:?} — не шоки"),
                    _ => {
                        let (cap, _) = combined.expect("шок есть — аллокация обязана быть");
                        let expected = [single_a, single_b]
                            .into_iter()
                            .flatten()
                            .map(|(c, _)| c)
                            .min()
                            .expect("хотя бы один шок");
                        assert_eq!(cap, expected, "{a:?} {b:?}: потолок акций не строжайший");
                    }
                }
            }
        }
    }

    #[test]
    fn combining_shocks_never_raises_the_equity_share() {
        for profile in RiskProfile::all() {
            for &a in &ALL_PHASES {
                for &b in &ALL_PHASES {
                    if combine_shock_allocation(&[a, b]).is_none() {
                        continue; // обычные фазы макроцикла — там другая модель
                    }
                    let combined = profile.adjusted_weights_combined(&[a, b]).0;
                    let single_a = profile.adjusted_weights(a).0;
                    let single_b = profile.adjusted_weights(b).0;
                    let strictest = single_a.min(single_b);
                    assert!(
                        combined <= strictest + EPS,
                        "{} {a:?}+{b:?}: акции {combined} > строжайшего одиночного {strictest}",
                        profile.label()
                    );
                }
            }
        }
    }

    #[test]
    fn market_phase_detection_is_total_and_deterministic() {
        let trends = ["", "up", "down", "flat", "рост", "падение", "UP"];
        let rates = [dec!(-5), dec!(0), dec!(12), dec!(100), dec!(99999)];
        let shocks = [
            "",
            " ",
            "\"war\"",
            " war ",
            "WAR",
            "война",
            "war;drop table",
            "🤷",
            "stagflation",
            "\n\tcrisis_fx\r",
        ];
        for trend in trends {
            for rate in rates {
                for shock in shocks {
                    let first = detect_market_phase(rate, trend, shock);
                    let second = detect_market_phase(rate, trend, shock);
                    assert_eq!(
                        first, second,
                        "не детерминирован: ставка {rate}, тренд {trend:?}, шок {shock:?}"
                    );
                }
            }
        }
        // Длинная строка не должна ронять разбор.
        let long = "war".repeat(50_000);
        let _ = detect_market_phase(dec!(15), "flat", &long);
    }

    #[test]
    fn known_shock_wins_over_rate_and_trend() {
        // Шок — приоритет над обычным циклом: одна и та же фаза при любых ставках.
        for shock in ["war", "crisis_global", "stagflation", "sanctions_hard"] {
            let reference = detect_market_phase(dec!(5), "up", shock);
            for rate in [dec!(-10), dec!(0), dec!(8), dec!(50)] {
                for trend in ["up", "down", "flat", ""] {
                    assert_eq!(
                        detect_market_phase(rate, trend, shock),
                        reference,
                        "шок {shock} не перебил ставку {rate} / тренд {trend}"
                    );
                }
            }
        }
    }

    #[test]
    fn arbitrary_strings_are_not_known_shocks() {
        for s in [
            "",
            " ",
            "war ",
            "war\n",
            "война",
            "crisis-global",
            "0",
            "null",
        ] {
            assert!(!is_known_shock(s) || s == "war", "«{s}» распознан как шок");
        }
    }
}
