//! Утилиты для MIME-типов и расширений имён файлов.

/// Вернуть расширение файла (без точки, как есть — регистр сохраняется) или
/// пустую строку. Если нужно сравнение без учёта регистра, caller приводит к
/// lowercase сам (как делает `is_image_file` ниже).
///
/// ```
/// assert_eq!(core_base::mime_utils::file_extension("cover.PNG"), "PNG");
/// assert_eq!(core_base::mime_utils::file_extension("noext"), "");
/// ```
pub fn file_extension(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((_, ext)) => ext,
        None => "",
    }
}

/// True, если имя выглядит как обычное изображение.
/// Исключает скрытые файлы (`.dot`), macOS-мусор (`__macosx`, `._`) и `thumbs.db`.
///
/// ```
/// assert!(core_base::mime_utils::is_image_file("page01.jpg"));
/// assert!(!core_base::mime_utils::is_image_file(".hidden.png"));
/// assert!(!core_base::mime_utils::is_image_file("page.txt"));
/// ```
pub fn is_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.starts_with('.')
        || lower.contains("__macosx")
        || lower.contains("thumbs.db")
        || lower.starts_with("._")
        || lower.ends_with('/')
    {
        return false;
    }
    matches!(
        lower.rsplit('.').next(),
        Some("jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif")
    )
}

/// MIME-тип по расширению изображения. По умолчанию `image/jpeg`.
pub fn mime_for(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "image/jpeg",
    }
}

/// Определение MIME-типа по начальным байтам (магическим числам) буфера.
/// Возвращает статический срез MIME-типа (напр. "image/png", "application/pdf")
/// даже если расширение файла отсутствует или было изменено.
pub fn mime_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    infer::get(bytes).map(|t| t.mime_type())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_lowercase() {
        assert_eq!(file_extension("a.JPG"), "JPG");
        assert_eq!(file_extension("a"), "");
    }

    #[test]
    fn image_detection() {
        assert!(is_image_file("1.png"));
        assert!(is_image_file("1.AVIF"));
        assert!(!is_image_file(".DS_Store"));
        assert!(!is_image_file("folder/"));
    }

    #[test]
    fn mime_defaults() {
        assert_eq!(mime_for("png"), "image/png");
        assert_eq!(mime_for("xyz"), "image/jpeg");
    }

    #[test]
    fn mime_magic_bytes() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert_eq!(mime_from_bytes(&png), Some("image/png"));

        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0];
        assert_eq!(mime_from_bytes(&jpeg), Some("image/jpeg"));

        let unknown = [0x00, 0x01, 0x02, 0x03];
        assert_eq!(mime_from_bytes(&unknown), None);
    }
}
