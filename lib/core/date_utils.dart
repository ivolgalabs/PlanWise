/// Утилиты работы с датами. Не зависят от Flutter.
library;

/// Возвращает полночь (00:00:00) данной даты.
DateTime atMidnight(DateTime d) => DateTime(d.year, d.month, d.day);

/// Начало недели, содержащей [date]. По умолчанию неделя с понедельника
/// (ISO). Если [startWithMonday] = false — неделя с воскресенья.
DateTime startOfWeek(DateTime date, {bool startWithMonday = true}) {
  final mid = atMidnight(date);
  // weekday: Пн=1 ... Вс=7 (Dart)
  final offset = startWithMonday ? mid.weekday - 1 : mid.weekday % 7;
  return mid.subtract(Duration(days: offset));
}

/// 7 дней недели, содержащей [date].
List<DateTime> weekDays(DateTime date, {bool startWithMonday = true}) {
  final start = startOfWeek(date, startWithMonday: startWithMonday);
  return List.generate(7, (i) => start.add(Duration(days: i)));
}

/// Сравнение дат без учёта времени.
bool isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;
