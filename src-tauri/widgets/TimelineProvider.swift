import WidgetKit

/// Общий провайдер для всех трёх виджетов: читает widget.json и строит
/// timeline на 15 минут — виджет не устаревает дольше этого интервала,
/// даже если приложение не запускалось (данные пишет планировщик Rust).
struct PlannerEntry: TimelineEntry {
  let date: Date
  let data: WidgetData?
}

struct PlannerProvider: TimelineProvider {
  func placeholder(in context: Context) -> PlannerEntry {
    PlannerEntry(date: Date(), data: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (PlannerEntry) -> Void) {
    completion(PlannerEntry(date: Date(), data: WidgetStore.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PlannerEntry>) -> Void) {
    let entry = PlannerEntry(date: Date(), data: WidgetStore.load())
    let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}
