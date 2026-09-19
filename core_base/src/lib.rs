pub mod config;

#[cfg(feature = "fs")]
pub mod fs_utils;

#[cfg(feature = "mime")]
pub mod mime_utils;

#[cfg(feature = "net")]
pub mod net_utils;

#[cfg(feature = "licensing")]
pub mod licensing;

#[cfg(feature = "finance")]
pub mod finance;

// sort_utils и diagnostics не имеют зависимостей и доступны всегда.
pub mod sort_utils;

/// Диагностика падений: кольцевой буфер + отчёт при панике (см. `Rules/checks/`).
pub mod diagnostics;

#[cfg(feature = "supervision")]
pub mod supervision;

pub use config::{ConfigError, ConfigManager};

#[cfg(feature = "fs")]
pub use fs_utils::FsUtils;

#[cfg(feature = "mime")]
pub use mime_utils::{file_extension, is_image_file, mime_for, mime_for as image_mime_for};

#[cfg(feature = "net")]
pub use net_utils::NetClient;

#[cfg(feature = "licensing")]
pub use licensing::{is_expired, obfuscate, validate_license, LicenseInfo};

#[cfg(feature = "finance")]
pub use finance::{
    combine_shock_allocation, combine_shocks, detect_market_phase, is_known_shock, MarketPhase,
    RiskProfile,
};

pub use sort_utils::{natural_cmp, NaturalCmp};

pub fn info() -> &'static str {
    "core_base v0.1.0 — Общая база воркспейса"
}
