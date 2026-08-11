import SwiftUI
import WidgetKit

/// Точка входа виджет-расширения: бандл из трёх виджетов —
/// «Задачи на сегодня», «Неделя» и «Когда-нибудь».
@main
struct PlannerWidgetsBundle: WidgetBundle {
  var body: some Widget {
    DayWidget()
    WeekWidget()
    SomedayWidget()
  }
}

/// Задачи на сегодня: small — счётчик, medium/large — список с временем.
struct DayWidget: Widget {
  let kind = "PlannerDayWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PlannerProvider()) { entry in
      DayWidgetView(data: entry.data)
    }
    .configurationDisplayName("Задачи на сегодня")
    .description("Список задач на сегодня из ежедневника.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

/// Неделя: 7 дней с сегодня, счётчики задач по дням.
struct WeekWidget: Widget {
  let kind = "PlannerWeekWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PlannerProvider()) { entry in
      WeekWidgetView(data: entry.data)
    }
    .configurationDisplayName("Неделя")
    .description("Задачи на 7 дней — сколько запланировано по дням.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

/// Когда-нибудь: задачи без даты.
struct SomedayWidget: Widget {
  let kind = "PlannerSomedayWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: PlannerProvider()) { entry in
      SomedayWidgetView(data: entry.data)
    }
    .configurationDisplayName("Когда-нибудь")
    .description("Задачи без привязки к дате.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
