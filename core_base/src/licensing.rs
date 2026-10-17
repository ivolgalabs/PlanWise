//! Lemon Squeezy licensing client — общий для приложений воркспейса.
//! Только чистая логика (без Tauri): валидация ключа через LS API, модель
//! лицензии, проверка срока действия, XOR-обфускация локального хранения.
//! Хранение файла лицензии и Tauri-команды остаются в приложении (тонкая обвязка).

use serde::{Deserialize, Serialize};

/// Состояние лицензии: хранится в приложении и передаётся в UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    pub key: String,
    pub activated: bool,
    pub machine_id: String,
    pub expires_at: Option<String>,
    /// ID инстанса LS из /activate — нужен для /deactivate (освободить место
    /// активации). None у кэшей до 2.0.97 и у ключей, принятых через /validate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    /// Unix-время последней успешной онлайн-проверки ключа (None у кэшей до неё).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<i64>,
    /// Unix-время создания ключа в LS (= дата покупки): от неё считается окно возврата.
    /// None у кэшей до 2.0.101 — заполняется первой же онлайн-проверкой.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct LemonSqueezyResponse {
    #[serde(default)]
    activated: Option<bool>,
    #[serde(default)]
    valid: Option<bool>,
    error: Option<String>,
    license_key: Option<LemonLicenseKey>,
    #[serde(default)]
    instance: Option<LemonInstance>,
    #[serde(default)]
    meta: Option<LemonMeta>,
}

#[derive(Debug, Deserialize)]
struct LemonMeta {
    variant_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct LemonInstance {
    id: String,
}

// Поля activation_limit/activation_usage не читаются приложением, но обязаны
// присутствовать в структуре — это ответ API LemonSqueezy (полный парсинг).
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct LemonLicenseKey {
    status: String,
    activation_limit: Option<i32>,
    activation_usage: Option<i32>,
    expires_at: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
}

/// XOR-обфускация для обратной совместимости локального хранения.
/// Salt — параметр: каждое приложение передаёт свой.
pub fn obfuscate(data: &[u8], salt: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let slen = salt.len().max(1);
    data.iter()
        .enumerate()
        .map(|(i, &b)| b ^ salt[i % slen])
        .collect()
}

/// Аппаратно-привязанная обфускация с побайтовой обратной связью (Cipher Feedback).
/// Комбинирует соль приложения и machine_id устройства.
/// Предотвращает перенос файла license.enc на другой компьютер и побитовую модификацию статуса активации.
pub fn obfuscate_machine_bound(data: &[u8], salt: &[u8], machine_id: &str) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let mut key = Vec::with_capacity(salt.len() + machine_id.len() + 8);
    key.extend_from_slice(salt);
    key.extend_from_slice(b"::hwid::");
    key.extend_from_slice(machine_id.as_bytes());
    if key.is_empty() {
        key.extend_from_slice(b"default_salt");
    }

    let klen = key.len();
    let mut result = Vec::with_capacity(data.len());
    let mut prev = 0xA5u8;
    for (i, &b) in data.iter().enumerate() {
        let k = key[i % klen] ^ prev;
        let enc = b ^ k;
        prev = enc;
        result.push(enc);
    }
    result
}

/// Деобфускация аппаратно-привязанного кэша.
pub fn deobfuscate_machine_bound(data: &[u8], salt: &[u8], machine_id: &str) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }
    let mut key = Vec::with_capacity(salt.len() + machine_id.len() + 8);
    key.extend_from_slice(salt);
    key.extend_from_slice(b"::hwid::");
    key.extend_from_slice(machine_id.as_bytes());
    if key.is_empty() {
        key.extend_from_slice(b"default_salt");
    }

    let klen = key.len();
    let mut result = Vec::with_capacity(data.len());
    let mut prev = 0xA5u8;
    for (i, &b) in data.iter().enumerate() {
        let k = key[i % klen] ^ prev;
        let dec = b ^ k;
        prev = b;
        result.push(dec);
    }
    result
}

const AGL2_MAGIC: &[u8; 4] = b"AGL2";

fn compute_integrity_hash(data: &[u8], machine_id: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for &b in data {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    for &b in machine_id.as_bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// AGL2-контейнер: магия + хеш целостности + JSON, обфусцированные с привязкой к машине.
fn seal<T: Serialize>(value: &T, machine_id: &str, salt: &[u8]) -> Result<Vec<u8>, String> {
    let serialized =
        serde_json::to_vec(value).map_err(|e| format!("Ошибка сериализации лицензии: {}", e))?;
    let hash = compute_integrity_hash(&serialized, machine_id);

    let mut payload = Vec::with_capacity(8 + serialized.len());
    payload.extend_from_slice(AGL2_MAGIC);
    payload.extend_from_slice(&hash.to_be_bytes());
    payload.extend_from_slice(&serialized);

    Ok(obfuscate_machine_bound(&payload, salt, machine_id))
}

/// None — не AGL2 (старый формат); Some(None) — подделка или другая машина; Some(Some) — JSON.
fn unseal(enc_data: &[u8], salt: &[u8], machine_id: &str) -> Option<Option<Vec<u8>>> {
    let dec = deobfuscate_machine_bound(enc_data, salt, machine_id);
    if dec.len() < 8 || &dec[0..4] != AGL2_MAGIC {
        return None;
    }
    let mut hash_bytes = [0u8; 4];
    hash_bytes.copy_from_slice(&dec[4..8]);
    let payload = &dec[8..];
    Some(
        (u32::from_be_bytes(hash_bytes) == compute_integrity_hash(payload, machine_id))
            .then(|| payload.to_vec()),
    )
}

/// Кодирует LicenseInfo в аппаратно-привязанный зашифрованный кэш с контролем целостности.
pub fn encode_license_cache(info: &LicenseInfo, salt: &[u8]) -> Result<Vec<u8>, String> {
    seal(info, &info.machine_id, salt)
}

/// Декодирует кэш лицензии с диска, проверяя целостность и привязку к аппаратному идентификатору текущего устройства.
/// Если файл был повреждён, подделан или перенесён с другого компьютера, возвращает ошибку.
/// Поддерживает автоматическую миграцию старого legacy-формата (простой XOR), если machine_id совпадает.
pub fn decode_license_cache(
    enc_data: &[u8],
    salt: &[u8],
    expected_machine_id: &str,
) -> Result<LicenseInfo, String> {
    if enc_data.is_empty() {
        return Err("Файл лицензии пуст".to_string());
    }

    // 1. Попытка деобфускации нового формата с аппаратной привязкой и проверкой целостности
    if let Some(payload) = unseal(enc_data, salt, expected_machine_id) {
        if let Some(info) = payload.and_then(|p| serde_json::from_slice::<LicenseInfo>(&p).ok()) {
            if info.machine_id == expected_machine_id {
                return Ok(info);
            }
        }
        return Err(
            "Нарушена целостность файла лицензии или не совпадает оборудование".to_string(),
        );
    }

    // 2. Fallback для плавного обновления существующих пользователей со старого XOR-формата
    let legacy_dec = obfuscate(enc_data, salt);
    if let Ok(info) = serde_json::from_slice::<LicenseInfo>(&legacy_dec) {
        if info.machine_id.is_empty() || info.machine_id == expected_machine_id {
            let mut migrated = info;
            migrated.machine_id = expected_machine_id.to_string();
            return Ok(migrated);
        }
    }

    Err("Файл лицензии недействителен или привязан к другому оборудованию".to_string())
}

// ── Срок действия лицензии ────────────────────────────────────────────────
// LemonSqueezy присылает expires_at в ISO 8601 (UTC), например
// "2026-12-31T23:59:59.000000Z". Парсим без внешних зависимостей
// (chrono/jiff в проекте нет) и сравниваем с текущим временем.

// Дни от начала эпохи (алгоритм Говарда Хиннанта, days_from_civil).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

// "YYYY-MM-DDTHH:MM:SS..." → unix-секунды (UTC; доли секунды и смещение игнорируются).
fn parse_iso_secs(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        std::str::from_utf8(b.get(r)?).ok()?.parse().ok()
    };
    let year = num(0..4)?;
    let month = num(5..7)?;
    let day = num(8..10)?;
    let hour = num(11..13)?;
    let minute = num(14..16)?;
    let second = num(17..19)?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(days * 86400 + hour * 3600 + minute * 60 + second)
}

/// Истёк ли срок действия (true — истёк/протух).
pub fn is_expired(expires_at: &str) -> bool {
    let Some(exp) = parse_iso_secs(expires_at) else {
        return false;
    };
    now_secs() > exp
}

/// Как часто ключ перепроверяется онлайн (возврат денег, снятие устройства).
pub const RECHECK_SECS: i64 = 7 * 86400;
/// Сколько активированное приложение работает без связи с LS после последней проверки.
pub const OFFLINE_GRACE_SECS: i64 = 30 * 86400;

/// Окно возврата денег: пока оно открыто, одноразовый ключ перепроверяется онлайн.
pub const REFUND_WINDOW_SECS: i64 = 60 * 86400;

impl LicenseInfo {
    /// Одноразовая покупка (без срока), которую LS подтвердил уже ПОСЛЕ окна возврата: вернуть деньги
    /// больше нельзя, поэтому сервер дальше не опрашивается и офлайн-запас не истекает. Подписка
    /// (`expires_at`) перепроверяется всегда. Дальнейшие проверки — только при активации, деактивации
    /// и исчерпанном лимите устройств (это делает сам LS).
    // shortcut: отметка checked_at — локальные часы; переведя их вперёд на успешной проверке, окно
    // можно «закрыть» досрочно. Цена обхода — возврат денег при работающем ключе; усилить — брать
    // время из заголовка Date ответа LS.
    pub fn settled(&self) -> bool {
        self.expires_at.is_none()
            && matches!((self.created_at, self.checked_at),
                (Some(c), Some(k)) if k >= c + REFUND_WINDOW_SECS)
    }

    /// Пора ли онлайн-перепроверка этого ключа (с учётом окна возврата).
    pub fn recheck_due(&self, now: i64) -> bool {
        !self.settled() && recheck_due(self.checked_at, now)
    }

    /// Вышел ли офлайн-запас этого ключа (у «закрытой» покупки не выходит никогда).
    pub fn offline_grace_over(&self, now: i64) -> bool {
        !self.settled() && offline_grace_over(self.checked_at, now)
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Пора ли перепроверить ключ онлайн. Время проверки в будущем (часы переведены назад) — тоже пора.
pub fn recheck_due(checked_at: Option<i64>, now: i64) -> bool {
    checked_at.is_none_or(|t| now - t >= RECHECK_SECS || t > now + 86400)
}

/// Истёк ли офлайн-запас. None — запас ещё не начат (приложение ставит отметку при первой неудаче).
pub fn offline_grace_over(checked_at: Option<i64>, now: i64) -> bool {
    checked_at.is_some_and(|t| now - t > OFFLINE_GRACE_SECS || t > now + 86400)
}

fn license_error(err: Option<&str>) -> String {
    match err {
        // LS: "This license key has reached the activation limit." (HTTP 400)
        Some(e) if e.to_lowercase().contains("activation limit") => "Активация отклонена: превышен лимит устройств. Деактивируйте лицензию на другом устройстве или через личный кабинет (Customer Portal) Lemon Squeezy, чтобы перенести её сюда.".to_string(),
        Some(e) if e.to_lowercase().contains("not found") => "Ключ не найден. Проверьте, что он скопирован полностью.".to_string(),
        Some(e) => format!("Ошибка лицензии: {}", e),
        None => "Эта лицензия недействительна (истекла, отключена или возвращены деньги)".to_string(),
    }
}

/// POST к License API LS. Ошибки клиента (4xx) LS отдаёт JSON-ом с полем error —
/// они разбираются; Err — только сеть, 5xx и 429 (повторить позже).
async fn post_ls(endpoint: &str, body: serde_json::Value) -> Result<LemonSqueezyResponse, String> {
    let res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!(
            "https://api.lemonsqueezy.com/v1/licenses/{endpoint}"
        ))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к серверу авторизации: {}", e))?;
    let status = res.status();
    if status.is_server_error() || status.as_u16() == 429 {
        return Err(format!("Сервер LemonSqueezy недоступен: {}", status));
    }
    res.json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа LemonSqueezy: {}", e))
}

/// Ключ принадлежит одному из разрешённых вариантов товара (ID вариантов LS уникальны
/// во всех магазинах, поэтому это же отсекает ключи чужих магазинов). Пустой список — отказ.
fn variant_allowed(r: &LemonSqueezyResponse, allowed_variants: &[u64]) -> bool {
    r.meta
        .as_ref()
        .and_then(|m| m.variant_id)
        .is_some_and(|v| allowed_variants.contains(&v))
}

/// Проверка и активация ключа: /validate (не занимает место, отсекает чужие, отключённые
/// и возвращённые ключи) → /activate (занимает место; при исчерпанном лимите LS отвечает
/// 400 с error, и активация отклоняется — обходного пути через /validate больше нет).
pub async fn validate_license(
    key: &str,
    instance_name: &str,
    allowed_variants: &[u64],
) -> Result<LicenseInfo, String> {
    let key = key.trim();
    let v = post_ls("validate", serde_json::json!({ "license_key": key })).await?;
    if v.valid != Some(true) {
        return Err(license_error(v.error.as_deref()));
    }
    if !variant_allowed(&v, allowed_variants) {
        return Err("Этот ключ не от этого приложения (и не от пропуска All-Access)".to_string());
    }

    let a = post_ls(
        "activate",
        serde_json::json!({ "license_key": key, "instance_name": instance_name }),
    )
    .await?;
    if a.activated != Some(true) {
        return Err(license_error(a.error.as_deref()));
    }
    let lk = a.license_key;
    Ok(LicenseInfo {
        key: key.to_string(),
        activated: true,
        machine_id: instance_name.to_string(),
        expires_at: lk.as_ref().and_then(|k| k.expires_at.clone()),
        instance_id: a.instance.map(|i| i.id),
        checked_at: Some(now_secs()),
        created_at: lk
            .and_then(|k| k.created_at)
            .as_deref()
            .and_then(parse_iso_secs),
    })
}

/// Итог повторной онлайн-проверки уже активированного ключа.
#[derive(Debug, PartialEq)]
pub enum Revalidation {
    /// Ключ действителен; `created_at` — дата покупки из ответа LS (для окна возврата).
    Valid { created_at: Option<i64> },
    /// Ключ отключён (возврат денег), истёк или место активации снято в Customer Portal.
    Revoked(String),
    /// Нет сети или LS недоступен — решает офлайн-запас.
    Unreachable,
}

pub async fn revalidate_license(key: &str, instance_id: Option<&str>) -> Revalidation {
    let mut body = serde_json::json!({ "license_key": key.trim() });
    if let Some(id) = instance_id {
        body["instance_id"] = id.into();
    }
    match post_ls("validate", body).await {
        Err(_) => Revalidation::Unreachable,
        Ok(r) if r.valid == Some(true) => Revalidation::Valid {
            created_at: r
                .license_key
                .and_then(|k| k.created_at)
                .as_deref()
                .and_then(parse_iso_secs),
        },
        Ok(r) => Revalidation::Revoked(license_error(r.error.as_deref())),
    }
}

#[derive(Debug, Deserialize)]
struct LemonDeactivateResponse {
    #[serde(default)]
    deactivated: bool,
    error: Option<String>,
}

/// Освобождает место активации на сервере LS (/v1/licenses/deactivate).
/// Err — только сбой сети/ответа: ключ остаётся активным локально, можно
/// повторить. Отказ LS (инстанс уже снят через Customer Portal, ключ удалён)
/// — Ok: на сервере освобождать уже нечего.
pub async fn deactivate_license(key: &str, instance_id: &str) -> Result<(), String> {
    let res = reqwest::Client::new()
        .post("https://api.lemonsqueezy.com/v1/licenses/deactivate")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "license_key": key.trim(), "instance_id": instance_id }))
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к серверу авторизации: {}", e))?;
    if res.status().is_server_error() {
        return Err(format!("Сервер LemonSqueezy недоступен: {}", res.status()));
    }
    let parsed: LemonDeactivateResponse = res
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа LemonSqueezy: {}", e))?;
    if !parsed.deactivated {
        eprintln!(
            "LemonSqueezy deactivate: {}",
            parsed.error.as_deref().unwrap_or("deactivated=false")
        );
    }
    Ok(())
}

// ── Пробный период ────────────────────────────────────────────────────────
// Начало пробного периода фиксирует сервер сайта (POST /api/trial, R2 trials/): удаление данных
// приложения его не сбрасывает, а дни считаются по часам сервера. Без сети пробный период
// не начинается; уже начатый идёт офлайн по локальным часам, но не назад (см. `secs_left`).

/// Длина пробного периода.
pub const TRIAL_SECS: i64 = 7 * 86400;

/// Локальная копия пробного периода (файл приложения, тот же AGL2-формат, что у лицензии).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct TrialRecord {
    pub machine_id: String,
    /// Unix-время начала по часам сервера.
    pub started_at: i64,
    /// Самое позднее виденное время (сервер или локальные часы): «сейчас» не бывает раньше него.
    pub last_seen: i64,
}

impl TrialRecord {
    /// Секунд до конца. Часы, переведённые назад, времени не возвращают: берётся max(now, last_seen).
    pub fn secs_left(&self, now: i64) -> i64 {
        (self.started_at + TRIAL_SECS - now.max(self.last_seen)).clamp(0, TRIAL_SECS)
    }

    /// Ответ сервера поверх локальной копии: раннее начало и позднее время побеждают.
    pub fn merged(
        local: Option<&TrialRecord>,
        machine_id: &str,
        started_at: i64,
        server_now: i64,
    ) -> TrialRecord {
        TrialRecord {
            machine_id: machine_id.to_string(),
            started_at: local.map_or(started_at, |l| l.started_at.min(started_at)),
            last_seen: local.map_or(server_now, |l| l.last_seen.max(server_now)),
        }
    }
}

pub fn encode_trial(rec: &TrialRecord, salt: &[u8]) -> Result<Vec<u8>, String> {
    seal(rec, &rec.machine_id, salt)
}

/// Err — файла нет в AGL2, он подделан или перенесён с другой машины.
pub fn decode_trial(enc_data: &[u8], salt: &[u8], machine_id: &str) -> Result<TrialRecord, String> {
    unseal(enc_data, salt, machine_id)
        .flatten()
        .and_then(|p| serde_json::from_slice::<TrialRecord>(&p).ok())
        .filter(|r| r.machine_id == machine_id)
        .ok_or_else(|| "Файл пробного периода недействителен".to_string())
}

#[derive(Debug, Deserialize)]
struct TrialResponse {
    started_at: i64,
    now: i64,
}

/// Регистрирует (или узнаёт) начало пробного периода устройства на сервере сайта.
/// `device` — 64 hex: солёный хеш machine_id, сам идентификатор железа не отправляется.
/// Ok((started_at, server_now)); Err — нет сети или сервер отказал.
pub async fn fetch_trial(url: &str, product: &str, device: &str) -> Result<(i64, i64), String> {
    let res = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .post(url)
        .json(&serde_json::json!({ "product": product, "device": device }))
        .send()
        .await
        .map_err(|e| format!("Нет связи с сервером пробного периода: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Сервер пробного периода ответил {}", res.status()));
    }
    let r: TrialResponse = res.json().await.map_err(|e| e.to_string())?;
    if r.started_at <= 0 || r.now <= 0 {
        return Err("Некорректный ответ сервера пробного периода".to_string());
    }
    Ok((r.started_at, r.now))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trial_counts_down_and_ignores_clock_rollback() {
        let t0 = 1_800_000_000;
        let rec = TrialRecord::merged(None, "M", t0, t0);
        assert_eq!(rec.secs_left(t0), TRIAL_SECS);
        assert_eq!(rec.secs_left(t0 + 6 * 86400), 86400); // день 7
        assert_eq!(rec.secs_left(t0 + 8 * 86400), 0); // день 8
        let seen = TrialRecord {
            last_seen: t0 + 8 * 86400,
            ..rec.clone()
        };
        assert_eq!(seen.secs_left(t0), 0, "часы назад не возвращают дни");
        assert_eq!(
            rec.secs_left(t0 - 365 * 86400),
            TRIAL_SECS,
            "не больше полного срока"
        );
        // сервер помнит более раннее начало (данные приложения удалены) — побеждает он
        let fresh_local = TrialRecord::merged(None, "M", t0 + 9 * 86400, t0 + 9 * 86400);
        let synced = TrialRecord::merged(Some(&fresh_local), "M", t0, t0 + 9 * 86400);
        assert_eq!(synced.started_at, t0);
        assert_eq!(synced.secs_left(t0 + 9 * 86400), 0);
    }

    #[test]
    fn trial_file_is_machine_bound_and_tamper_proof() {
        let rec = TrialRecord {
            machine_id: "M1".into(),
            started_at: 10,
            last_seen: 20,
        };
        let enc = encode_trial(&rec, b"salt").unwrap();
        assert_eq!(decode_trial(&enc, b"salt", "M1").unwrap(), rec);
        assert!(decode_trial(&enc, b"salt", "M2").is_err(), "другая машина");
        let mut bad = enc.clone();
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert!(decode_trial(&bad, b"salt", "M1").is_err(), "подделка");
        assert!(decode_trial(b"", b"salt", "M1").is_err());
        // файл лицензии не читается как пробный период
        let lic = LicenseInfo {
            key: "K".into(),
            activated: true,
            machine_id: "M1".into(),
            expires_at: None,
            instance_id: None,
            checked_at: None,
            created_at: None,
        };
        assert!(
            decode_trial(&encode_license_cache(&lic, b"salt").unwrap(), b"salt", "M1").is_err()
        );
    }

    /// Живой сервер: `TRIAL_URL=http://127.0.0.1:8799/api/trial cargo test --features licensing live_trial -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_trial_server_keeps_the_first_start() {
        let url = std::env::var("TRIAL_URL").expect("TRIAL_URL");
        let dev = format!("{:064x}", now_secs());
        let (s1, _) = fetch_trial(&url, "tensormedia", &dev).await.unwrap();
        let (s2, n2) = fetch_trial(&url, "tensormedia", &dev).await.unwrap();
        assert_eq!(s1, s2);
        assert!(n2 >= s1);
        assert!(fetch_trial(&url, "tensormedia", "../x").await.is_err());
    }

    #[test]
    fn obfuscate_roundtrip() {
        let data = b"test-license-data";
        let salt = b"AppSalt_2026";
        let enc = obfuscate(data, salt);
        assert_ne!(enc, data);
        assert_eq!(obfuscate(&enc, salt), data);
    }

    #[test]
    fn machine_bound_roundtrip() {
        let data = b"sensitive-license-payload-2026";
        let salt = b"AppSalt_2026";
        let machine_id = "macOS-Serial-ABC-123";

        let enc = obfuscate_machine_bound(data, salt, machine_id);
        assert_ne!(enc, data);

        let dec = deobfuscate_machine_bound(&enc, salt, machine_id);
        assert_eq!(dec, data);
    }

    #[test]
    fn machine_bound_cross_machine_rejection() {
        let info = LicenseInfo {
            key: "LS-TEST-KEY-1234".to_string(),
            activated: true,
            machine_id: "machine-A-original".to_string(),
            expires_at: None,
            instance_id: None,
            checked_at: None,
            created_at: None,
        };
        let salt = b"AppSalt_2026";

        let encoded = encode_license_cache(&info, salt).expect("encoding succeeds");

        // Попытка расшифровать на машине B (другой machine_id) должна завершиться ошибкой
        let res_b = decode_license_cache(&encoded, salt, "machine-B-stolen");
        assert!(
            res_b.is_err(),
            "Должно отвергнуть перенос лицензии на другой компьютер"
        );

        // На машине A расшифровка успешна
        let res_a =
            decode_license_cache(&encoded, salt, "machine-A-original").expect("decoding succeeds");
        assert_eq!(res_a.key, "LS-TEST-KEY-1234");
        assert!(res_a.activated);
    }

    #[test]
    fn machine_bound_tamper_detection() {
        let info = LicenseInfo {
            key: "LS-TEST-KEY-1234".to_string(),
            activated: true,
            machine_id: "machine-A".to_string(),
            expires_at: None,
            instance_id: None,
            checked_at: None,
            created_at: None,
        };
        let salt = b"AppSalt_2026";

        let mut encoded = encode_license_cache(&info, salt).expect("encoding succeeds");

        // Модифицируем 1 байт в зашифрованных данных (попытка подделки)
        if let Some(byte) = encoded.get_mut(10) {
            *byte ^= 0xFF;
        }

        // Из-за лавинного эффекта обратной связи (CFB) десериализация должна упасть
        let tampered_res = decode_license_cache(&encoded, salt, "machine-A");
        assert!(
            tampered_res.is_err(),
            "Подделка байта должна быть обнаружена и отклонена"
        );
    }

    #[test]
    fn legacy_format_migration() {
        let info = LicenseInfo {
            key: "LS-LEGACY-KEY-5678".to_string(), // gitleaks:allow (test fixture)
            activated: true,
            machine_id: "machine-legacy".to_string(),
            expires_at: None,
            instance_id: None,
            checked_at: None,
            created_at: None,
        };
        let salt = b"AppSalt_2026";

        // Старый формат: простой XOR без привязки
        let legacy_json = serde_json::to_vec(&info).unwrap();
        let legacy_enc = obfuscate(&legacy_json, salt);

        // Расшифровка на том же компьютере должна успешно пройти миграцию
        let migrated =
            decode_license_cache(&legacy_enc, salt, "machine-legacy").expect("migration succeeds");
        assert_eq!(migrated.key, "LS-LEGACY-KEY-5678"); // gitleaks:allow (test fixture)

        // Расшифровка старого файла на чужом компьютере отклоняется
        let stolen_legacy = decode_license_cache(&legacy_enc, salt, "foreign-machine");
        assert!(stolen_legacy.is_err());
    }

    #[test]
    fn instance_id_roundtrip_and_old_cache_compat() {
        let salt = b"AppSalt_2026";
        let mut info = LicenseInfo {
            key: "LS-TEST-KEY-1234".to_string(),
            activated: true,
            machine_id: "m".to_string(),
            expires_at: None,
            instance_id: None,
            checked_at: None,
            created_at: None,
        };
        // Без instance_id JSON не меняется — кэш старой версии не перезаписывается.
        assert!(!String::from_utf8(serde_json::to_vec(&info).unwrap())
            .unwrap()
            .contains("instance_id"));
        info.instance_id = Some("inst-1".to_string());
        let enc = encode_license_cache(&info, salt).unwrap();
        let dec = decode_license_cache(&enc, salt, "m").unwrap();
        assert_eq!(dec.instance_id.as_deref(), Some("inst-1"));
        // Ответ /activate: instance.id попадает в разбор.
        let r: LemonSqueezyResponse = serde_json::from_str(
            r#"{"activated":true,"error":null,"license_key":null,"instance":{"id":"abc","name":"m"}}"#,
        )
        .unwrap();
        assert_eq!(r.instance.map(|i| i.id).as_deref(), Some("abc"));
    }

    #[test]
    fn recheck_and_grace_policy() {
        let now = 1_000_000_000;
        assert!(recheck_due(None, now));
        assert!(!recheck_due(Some(now - 86400), now));
        assert!(recheck_due(Some(now - RECHECK_SECS), now));
        assert!(recheck_due(Some(now + 3 * 86400), now)); // часы переведены назад
        assert!(!offline_grace_over(None, now));
        assert!(!offline_grace_over(Some(now - 10 * 86400), now));
        assert!(offline_grace_over(Some(now - OFFLINE_GRACE_SECS - 1), now));
        assert!(offline_grace_over(Some(now + 3 * 86400), now));
    }

    #[test]
    fn refund_window_settles_one_time_keys_only() {
        let now = 2_000_000_000;
        let bought = now - 100 * 86400;
        let mk = |expires: Option<&str>, created: Option<i64>, checked: Option<i64>| LicenseInfo {
            key: "K".into(),
            activated: true,
            machine_id: "m".into(),
            expires_at: expires.map(str::to_string),
            instance_id: None,
            checked_at: checked,
            created_at: created,
        };
        // проверен ПОСЛЕ окна возврата → закрыт: ни перепроверок, ни офлайн-лимита
        let done = mk(None, Some(bought), Some(bought + REFUND_WINDOW_SECS + 1));
        assert!(done.settled());
        assert!(!done.recheck_due(now));
        assert!(!done.offline_grace_over(now + 400 * 86400));
        // последняя проверка внутри окна → нужна ещё одна, уже после окна
        let open = mk(None, Some(bought), Some(bought + 50 * 86400));
        assert!(!open.settled());
        assert!(open.recheck_due(now));
        assert!(open.offline_grace_over(now));
        // кэш без даты покупки (старая версия) — не закрыт, пока проверка не принесёт created_at
        assert!(!mk(None, None, Some(now)).settled());
        // подписка проверяется всегда
        let sub = mk(
            Some("2027-01-01T00:00:00Z"),
            Some(bought),
            Some(now - 8 * 86400),
        );
        assert!(!sub.settled());
        assert!(sub.recheck_due(now));
    }

    #[test]
    fn purchase_date_comes_from_ls_iso_time() {
        assert_eq!(
            parse_iso_secs("2026-10-13T12:00:00.000000Z"),
            Some(1_791_892_800)
        );
    }

    #[test]
    fn variant_and_error_mapping() {
        let r: LemonSqueezyResponse = serde_json::from_str(
            r#"{"valid":true,"error":null,"license_key":{"status":"active","activation_limit":3,"activation_usage":1,"expires_at":null},"meta":{"store_id":1,"variant_id":2199220}}"#,
        )
        .unwrap();
        assert!(variant_allowed(&r, &[2199220, 2199229]));
        assert!(!variant_allowed(&r, &[42]));
        assert!(!variant_allowed(&r, &[]));
        // Ответ LS 400 при исчерпанном лимите разбирается и даёт отказ, а не обход.
        let limit: LemonSqueezyResponse = serde_json::from_str(
            r#"{"activated":false,"error":"This license key has reached the activation limit.","license_key":null,"instance":null,"meta":null}"#,
        )
        .unwrap();
        assert_ne!(limit.activated, Some(true));
        assert!(license_error(limit.error.as_deref()).contains("лимит устройств"));
        assert!(license_error(None).contains("недействительна"));
    }

    #[test]
    fn expiry_check() {
        // Просроченная дата (прошлое) — истекла.
        assert!(is_expired("2020-01-01T00:00:00.000000Z"));
        // Будущая дата — не истекла.
        assert!(!is_expired("2099-01-01T00:00:00.000000Z"));
        // Непарсибельная строка — считается не истекшей (семантика сохранена).
        assert!(!is_expired("not-a-date"));
    }
}
