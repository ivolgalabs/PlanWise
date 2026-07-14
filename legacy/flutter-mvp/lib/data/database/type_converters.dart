/// Конвертация DateTime (полночь) <-> epoch-day (int).
/// epoch-day = число дней с 1970-01-01.
int toEpochDay(DateTime date) {
  final utc = DateTime.utc(date.year, date.month, date.day);
  return utc.difference(DateTime.utc(1970, 1, 1)).inDays;
}

DateTime fromEpochDay(int epochDay) {
  final utc = DateTime.utc(1970, 1, 1).add(Duration(days: epochDay));
  return DateTime(utc.year, utc.month, utc.day);
}

/// Конвертация DateTime <-> epoch-millis.
int toEpochMillis(DateTime dt) => dt.toUtc().millisecondsSinceEpoch;

DateTime fromEpochMillis(int ms) =>
    DateTime.fromMillisecondsSinceEpoch(ms, isUtc: false).toLocal();
