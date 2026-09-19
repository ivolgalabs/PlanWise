use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Ошибка ввода-вывода: {0}")]
    Io(#[from] std::io::Error),
    #[error("Ошибка сериализации/десериализации JSON: {0}")]
    Json(#[from] serde_json::Error),
}

/// Утилита для сохранения и загрузки конфигураций в формате JSON
pub struct ConfigManager;

impl ConfigManager {
    pub fn load<T: DeserializeOwned, P: AsRef<Path>>(path: P) -> Result<T, ConfigError> {
        let content = fs::read_to_string(path)?;
        let config = serde_json::from_str(&content)?;
        Ok(config)
    }

    pub fn save<T: Serialize, P: AsRef<Path>>(config: &T, path: P) -> Result<(), ConfigError> {
        let content = serde_json::to_string_pretty(config)?;
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, content)?;
        Ok(())
    }
}
