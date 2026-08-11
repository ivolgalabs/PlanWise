import Foundation

/// Модели данных виджета — зеркало widget.json, который пишет Rust
/// (src-tauri/src/commands.rs → refresh_widget).
struct WidgetTask: Decodable {
  let title: String
  let timeMinutes: Int?
  let isDone: Bool
}

struct WidgetDay: Decodable {
  let date: Int
  let tasks: [WidgetTask]
}

struct WidgetData: Decodable {
  let date: Int
  let tasks: [WidgetTask]
  let week: [WidgetDay]
  let someday: [WidgetTask]
}

/// Чтение widget.json из App Group контейнера — Rust дублирует туда файл
/// (src-tauri/src/commands.rs → refresh_widget). Песочный виджет может
/// читать только свой контейнер группы, поэтому путь Application Support
/// напрямую недоступен.
enum WidgetStore {
  static let groupId = "group.com.zkproject.dailyplanner"
  static let fileName = "widget.json"

  static func load() -> WidgetData? {
    // App Group контейнер (основной путь для песочного расширения).
    if let url = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: groupId
    )?.appendingPathComponent(fileName),
      let data = try? Data(contentsOf: url),
      let parsed = try? JSONDecoder().decode(WidgetData.self, from: data)
    {
      return parsed
    }
    // Фолбэк: старый путь Application Support (если расширение запущено
    // без песочницы, например при отладке).
    guard let home = FileManager.default.homeDirectoryForCurrentUser as NSURL?,
      let base = home.appendingPathComponent(
        "Library/Application Support/com.zkproject.dailyplanner"
      )
    else { return nil }
    let url = base.appendingPathComponent(fileName)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(WidgetData.self, from: data)
  }

  /// «Сегодня» из файла (epoch-day, локальная дата устройства — как в Rust).
  static func dayDate(_ epochDay: Int) -> Date {
    let ms = TimeInterval(epochDay) * 86_400
    return Date(timeIntervalSince1970: ms)
  }

  /// Час:минута из минут от полуночи («09:05»), null — «в течение дня».
  static func timeLabel(_ minutes: Int?) -> String {
    guard let m = minutes, m >= 0 else { return "" }
    let h = m / 60, mm = m % 60
    return String(format: "%02d:%02d", h, mm)
  }
}
