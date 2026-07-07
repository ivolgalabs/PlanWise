import 'package:drift/drift.dart';

/// Таблица задач. Поле [date] хранится как epoch-day (int): количество дней
/// с 1970-01-01. Это даёт индексируемое, таймзоно-независимое сравнение дат.
@DataClassName('TaskRow')
class Tasks extends Table {
  TextColumn get id => text()();
  TextColumn get title => text()();
  IntColumn get date => integer()(); // epoch-day
  BoolColumn get isDone => boolean().withDefault(const Constant(false))();
  TextColumn get colorSetId => text().nullable()();
  RealColumn get sortOrder => real().withDefault(const Constant(0.0))();
  IntColumn get createdAt => integer()(); // epoch-ms
  IntColumn get updatedAt => integer()(); // epoch-ms
  TextColumn get deviceId => text()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Таблица наборов цветов.
@DataClassName('ColorSetRow')
class ColorSets extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  IntColumn get color => integer()(); // ARGB
  RealColumn get sortOrder => real()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Простое key-value хранилище настроек.
class Settings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}
