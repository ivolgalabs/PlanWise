/// Чистые доменные модели. Не зависят от Drift/Flutter — тестируются без БД.
library;

/// Дата без времени: только год/месяц/день. Используем чистый DateTime
/// с обнулённым временем. Сравнение и хранение — по полуночи локальной даты.
typedef LocalDate = DateTime;

/// Одна задача в ежедневнике.
class Task {
  Task({
    required this.id,
    required this.title,
    required this.date,
    required this.isDone,
    required this.colorSetId,
    required this.sortOrder,
    required this.createdAt,
    required this.updatedAt,
    required this.deviceId,
  });

  final String id;
  final String title;
  final DateTime date; // midnight-local
  final bool isDone;
  final String? colorSetId;
  final double sortOrder;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String deviceId;

  Task copyWith({
    String? title,
    DateTime? date,
    bool? isDone,
    String? colorSetId,
    double? sortOrder,
    DateTime? updatedAt,
  }) =>
      Task(
        id: id,
        title: title ?? this.title,
        date: date ?? this.date,
        isDone: isDone ?? this.isDone,
        colorSetId: colorSetId ?? this.colorSetId,
        sortOrder: sortOrder ?? this.sortOrder,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
        deviceId: deviceId,
      );
}

/// Сет цветов для группировки задач (например «Работа», «Личное»).
class ColorSet {
  const ColorSet({
    required this.id,
    required this.name,
    required this.color,
    required this.sortOrder,
  });

  final String id;
  final String name;
  final int color; // ARGB (0xAARRGGBB)
  final double sortOrder;
}
