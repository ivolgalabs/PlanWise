use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Утилиты для работы с файлами и директориями
pub struct FsUtils;

impl FsUtils {
    /// Проверяет существование пути и создаёт директорию, если её нет
    pub fn ensure_dir<P: AsRef<Path>>(path: P) -> io::Result<PathBuf> {
        let p = path.as_ref();
        if !p.exists() {
            fs::create_dir_all(p)?;
        }
        Ok(p.to_path_buf())
    }

    /// Безопасное чтение файла с ошибкой, если он не найден
    pub fn read_file_to_string<P: AsRef<Path>>(path: P) -> io::Result<String> {
        fs::read_to_string(path)
    }

    /// Безопасная запись строки в файл
    pub fn write_string_to_file<P: AsRef<Path>>(path: P, content: &str) -> io::Result<()> {
        if let Some(parent) = path.as_ref().parent() {
            Self::ensure_dir(parent)?;
        }
        fs::write(path, content)
    }
}
