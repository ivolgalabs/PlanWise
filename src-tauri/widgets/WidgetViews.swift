import SwiftUI
import WidgetKit

/// Адаптивный цвет: светлая тема — кремовый фон приложения (#F4F1EC),
/// тёмная — тёмный фон системы. Динамический NSColor сам переключается
/// по системной теме.
private func adaptive(_ light: Color, _ dark: Color) -> Color {
  Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(dark) : NSColor(light)
    }
  )
}

private enum W {
  static let bg = adaptive(
    Color(red: 0.957, green: 0.945, blue: 0.925),
    Color(red: 0.11, green: 0.11, blue: 0.12)
  )
  static let text = adaptive(
    Color(red: 0.12, green: 0.14, blue: 0.16),
    Color(red: 0.92, green: 0.92, blue: 0.94)
  )
  static let muted = adaptive(
    Color(red: 0.45, green: 0.45, blue: 0.47),
    Color(red: 0.62, green: 0.62, blue: 0.66)
  )
  static let accent = adaptive(
    Color(red: 0.85, green: 0.47, blue: 0.15),
    Color(red: 0.95, green: 0.65, blue: 0.35)
  )
}

/// Строка задачи: «09:00  Название» или просто название; выполненные —
/// зачёркнуты и приглушены (как в Android-виджете).
private struct TaskRow: View {
  let task: WidgetTask
  var showTime = true

  var body: some View {
    HStack(spacing: 5) {
      if showTime, let m = task.timeMinutes, m >= 0 {
        Text(WidgetStore.timeLabel(m))
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(W.muted)
          .layoutPriority(1)
      }
      Text(task.title)
        .font(.system(size: 12, weight: .regular))
        .lineLimit(1)
        .strikethrough(task.isDone)
        .foregroundStyle(task.isDone ? W.muted : W.text)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct WidgetHeader: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .bold, design: .rounded))
      .foregroundStyle(W.accent)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct EmptyLine: View {
  var body: some View {
    Text("Нет задач")
      .font(.system(size: 12))
      .foregroundStyle(W.muted)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: — День: задачи на сегодня

struct DayWidgetView: View {
  let data: WidgetData?

  var body: some View {
    Group {
      if let data = data, !data.tasks.isEmpty {
        let pending = data.tasks.filter { !$0.isDone }.count
        let rows = Array(data.tasks.prefix(6))
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Задачи на сегодня (\(pending))")
          ForEach(Array(rows.enumerated()), id: \.offset) { _, t in
            TaskRow(task: t)
          }
          Spacer(minLength: 0)
        }
      } else {
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Задачи на сегодня")
          EmptyLine()
          Spacer(minLength: 0)
        }
      }
    }
    .widgetBackground(W.bg)
  }
}

// MARK: — Неделя: 7 дней, счётчики задач

struct WeekWidgetView: View {
  let data: WidgetData?

  var body: some View {
    Group {
      if let data = data {
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Неделя")
          ForEach(Array(data.week.enumerated()), id: \.offset) { i, day in
            let tasks = day.tasks
            let isToday = day.date == data.date
            HStack(spacing: 5) {
              Text(weekdayLabel(day.date))
                .font(.system(size: 11, weight: isToday ? .bold : .semibold))
                .foregroundStyle(isToday ? W.accent : W.muted)
                .frame(width: 34, alignment: .leading)
              if tasks.isEmpty {
                Text("—")
                  .font(.system(size: 11))
                  .foregroundStyle(W.muted)
              } else {
                Text(daySummary(tasks, isToday: isToday))
                  .font(.system(size: 11))
                  .lineLimit(1)
                  .strikethrough(tasks.allSatisfy { $0.isDone })
                  .foregroundStyle(W.text)
              }
              Spacer(minLength: 0)
            }
          }
          Spacer(minLength: 0)
        }
      } else {
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Неделя")
          EmptyLine()
          Spacer(minLength: 0)
        }
      }
    }
    .widgetBackground(W.bg)
  }

  private func weekdayLabel(_ epochDay: Int) -> String {
    let d = WidgetStore.dayDate(epochDay)
    let f = DateFormatter()
    f.locale = Locale(identifier: "ru_RU")
    f.dateFormat = "EE"
    return f.string(from: d)
  }

  private func daySummary(_ tasks: [WidgetTask], isToday: Bool) -> String {
    if isToday {
      // Сегодня: первая задача с временем, если есть.
      if let first = tasks.first(where: { $0.timeMinutes != nil && !$0.isDone }) {
        return "\(WidgetStore.timeLabel(first.timeMinutes)) · \(tasks.count) зад."
      }
      return "\(tasks.count) зад."
    }
    return "\(tasks.count) зад."
  }
}

// MARK: — Когда-нибудь

struct SomedayWidgetView: View {
  let data: WidgetData?

  var body: some View {
    Group {
      if let data = data, !data.someday.isEmpty {
        let rows = Array(data.someday.prefix(8))
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Когда-нибудь")
          ForEach(Array(rows.enumerated()), id: \.offset) { _, t in
            TaskRow(task: t, showTime: false)
          }
          Spacer(minLength: 0)
        }
      } else {
        VStack(alignment: .leading, spacing: 3) {
          WidgetHeader(text: "Когда-нибудь")
          EmptyLine()
          Spacer(minLength: 0)
        }
      }
    }
    .widgetBackground(W.bg)
  }
}

// MARK: — Хелперы

extension View {
  /// Фон виджета (macOS 14+): системный, подстраивается под форму.
  func widgetBackground(_ color: Color) -> some View {
    if #available(macOS 14.0, *) {
      return self.containerBackground(for: .widget) { color }
    } else {
      return self.background(color)
    }
  }
}
