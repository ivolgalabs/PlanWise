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
    #[serde(default)]
    activated: Option<bool>,
    #[serde(default)]
    valid: Option<bool>,
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

/// Кодирует LicenseInfo в аппаратно-привязанный зашифрованный кэш с контролем целостности.
pub fn encode_license_cache(info: &LicenseInfo, salt: &[u8]) -> Result<Vec<u8>, String> {
    let serialized =
        serde_json::to_vec(info).map_err(|e| format!("Ошибка сериализации лицензии: {}", e))?;
    let hash = compute_integrity_hash(&serialized, &info.machine_id);

    let mut payload = Vec::with_capacity(8 + serialized.len());
    payload.extend_from_slice(AGL2_MAGIC);
    payload.extend_from_slice(&hash.to_be_bytes());
    payload.extend_from_slice(&serialized);

    Ok(obfuscate_machine_bound(&payload, salt, &info.machine_id))
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
    let dec = deobfuscate_machine_bound(enc_data, salt, expected_machine_id);
    if dec.len() >= 8 && &dec[0..4] == AGL2_MAGIC {
        let mut hash_bytes = [0u8; 4];
        hash_bytes.copy_from_slice(&dec[4..8]);
        let expected_hash = u32::from_be_bytes(hash_bytes);
        let payload = &dec[8..];
        let actual_hash = compute_integrity_hash(payload, expected_machine_id);

        if expected_hash == actual_hash {
            if let Ok(info) = serde_json::from_slice::<LicenseInfo>(payload) {
                if info.machine_id == expected_machine_id {
                    return Ok(info);
                }
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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    now > exp
}

/// Валидация и активация ключа через LemonSqueezy API (/v1/licenses/activate и /validate).
/// Сначала вызывает /activate (регистрирует инстанс машины на сервере LS),
/// при повторной проверке или сбоях валидирует через /validate.
/// Возвращает LicenseInfo (activated=true) при успехе или Err с сообщением для UI.
pub async fn validate_license(key: &str, instance_name: &str) -> Result<LicenseInfo, String> {
    let client = reqwest::Client::new();
    let req_body = LemonSqueezyRequest {
        license_key: key.trim().to_string(),
        instance_name: instance_name.to_string(),
    };

    // 1. Попытка прямой активации устройства через /licenses/activate
    let act_res = client
        .post("https://api.lemonsqueezy.com/v1/licenses/activate")
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&req_body)
        .send()
        .await;

    if let Ok(res) = act_res {
        if res.status().is_success() {
            if let Ok(parsed) = res.json::<LemonSqueezyResponse>().await {
                if let Some(err) = parsed.error {
                    if err.contains("Activation limit reached") || err.contains("limit reached") {
                        return Err("Активация отклонена: превышен лимит устройств. Пожалуйста, деактивируйте лицензию на другом компьютере через портал Lemon Squeezy (Customer Portal).".to_string());
                    }
                } else if parsed.activated.unwrap_or(false) || parsed.valid.unwrap_or(false) {
                    let expires_at = parsed
                        .license_key
                        .as_ref()
                        .and_then(|k| k.expires_at.clone());
                    return Ok(LicenseInfo {
                        key: key.trim().to_string(),
                        activated: true,
                        machine_id: instance_name.to_string(),
                        expires_at,
                    });
                }
            }
        }
    }

    // 2. Валидация через /licenses/validate (для уже активированных инстансов)
    let val_res = client
        .post("https://api.lemonsqueezy.com/v1/licenses/validate")
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка подключения к серверу авторизации: {}", e))?;

    if !val_res.status().is_success() {
        return Err("Сервер LemonSqueezy вернул ошибку запроса".to_string());
    }

    let parsed: LemonSqueezyResponse = val_res
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга ответа LemonSqueezy: {}", e))?;

    if let Some(err) = parsed.error {
        if err.contains("Activation limit reached") || err.contains("limit reached") {
            return Err("Активация отклонена: превышен лимит устройств. Пожалуйста, деактивируйте лицензию на другом устройстве или через личный кабинет (Customer Portal) Lemon Squeezy, чтобы перенести её сюда.".to_string());
        }
        return Err(format!("Ошибка лицензии: {}", err));
    }

    let is_valid = parsed.valid.unwrap_or(false) || parsed.activated.unwrap_or(false);
    if !is_valid {
        return Err("Эта лицензия недействительна".to_string());
    }

    if let Some(license_info) = parsed.license_key {
        // Принимаем как active, так и inactive (новый ключ до первого использования)
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
    fn expiry_check() {
        // Просроченная дата (прошлое) — истекла.
        assert!(is_expired("2020-01-01T00:00:00.000000Z"));
        // Будущая дата — не истекла.
        assert!(!is_expired("2099-01-01T00:00:00.000000Z"));
        // Непарсибельная строка — считается не истекшей (семантика сохранена).
        assert!(!is_expired("not-a-date"));
    }
}
