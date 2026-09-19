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
}

#[derive(Debug, Serialize, Deserialize)]
struct LemonSqueezyRequest {
    license_key: String,
    instance_name: String,
}

#[derive(Debug, Deserialize)]
struct LemonSqueezyResponse {
    valid: bool,
    error: Option<String>,
    license_key: Option<LemonLicenseKey>,
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
}

/// XOR-обфускация для локального хранения ключа (не шифрование — прячет ключ в файле).
/// Salt — параметр: каждое приложение передаёт свой.
pub fn obfuscate(data: &[u8], salt: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, &b)| b ^ salt[i % salt.len()])
        .collect()
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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    now > exp
}

/// Валидация ключа через LemonSqueezy API (/v1/licenses/validate).
/// Возвращает LicenseInfo (activated=true) при успехе или Err с сообщением для UI.
/// Текст сообщений — на русском (UI приложений воркспейса); при мультиязычности —
/// перевести на коды ошибок.
pub async fn validate_license(key: &str, instance_name: &str) -> Result<LicenseInfo, String> {
    let client = reqwest::Client::new();
    let req_body = LemonSqueezyRequest {
        license_key: key.trim().to_string(),
        instance_name: instance_name.to_string(),
    };

    let res = client
        .post("https://api.lemonsqueezy.com/v1/licenses/validate")
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к серверу авторизации: {}", e))?;

    if !res.status().is_success() {
        return Err("Сервер LemonSqueezy вернул ошибку запроса".to_string());
    }

    let parsed: LemonSqueezyResponse = res
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа LemonSqueezy: {}", e))?;

    if let Some(err) = parsed.error {
        if err.contains("Activation limit reached") || err.contains("limit reached") {
            return Err("Активация отклонена: превышен лимит устройств. Пожалуйста, деактивируйте лицензию на другом устройстве или через личный кабинет (Customer Portal) Lemon Squeezy, чтобы перенести её сюда.".to_string());
        }
        return Err(format!("Ошибка лицензии: {}", err));
    }

    if !parsed.valid {
        return Err("Эта лицензия недействительна".to_string());
    }

    if let Some(license_info) = parsed.license_key {
        if license_info.status != "active" {
            return Err(format!(
                "Лицензия не активна (статус: {})",
                license_info.status
            ));
        }

        return Ok(LicenseInfo {
            key: key.trim().to_string(),
            activated: true,
            machine_id: instance_name.to_string(),
            expires_at: license_info.expires_at,
        });
    }

    Err("Не удалось получить информацию о лицензии".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscate_roundtrip() {
        let data = b"test-license-data";
        let salt = b"AppSalt_2026";
        let enc = obfuscate(data, salt);
        assert_ne!(enc, data);
        assert_eq!(obfuscate(&enc, salt), data);
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
