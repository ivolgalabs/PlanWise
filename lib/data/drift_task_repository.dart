import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/database/type_converters.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/domain/task_repository.dart';
import 'package:drift/drift.dart';

/// Реализация [TaskRepository] поверх Drift. Переводит доменные модели
/// (DateTime) в столбцы БД (epoch-day, epoch-ms) и обратно.
class DriftTaskRepository implements TaskRepository {
  DriftTaskRepository(this._db, {required this.deviceId});

  final AppDatabase _db;
  final String deviceId;

  @override
  Future<List<Task>> tasksForDate(DateTime date) async {
    final rows = await _db.tasksForEpochDay(toEpochDay(date));
    return rows.map(_toDomain).toList();
  }

  @override
  Future<List<Task>> tasksInRange(DateTime start, DateTime end) async {
    final rows = await _db.tasksInRange(toEpochDay(start), toEpochDay(end));
    return rows.map(_toDomain).toList();
  }

  @override
  Stream<List<Task>> watchTasksInRange(DateTime start, DateTime end) {
    return _db
        .watchTasksInRange(toEpochDay(start), toEpochDay(end))
        .map((rows) => rows.map(_toDomain).toList());
  }

  @override
  Future<List<Task>> overdueBefore(DateTime date) async {
    final rows = await _db.overdueBefore(toEpochDay(date));
    return rows.map(_toDomain).toList();
  }

  @override
  Future<void> upsertTask(Task task) async {
    await _db.upsertTask(_toCompanion(task));
  }

  @override
  Future<void> deleteTask(String id) async {
    await _db.removeTask(id);
  }

  @override
  Future<void> moveTask(String id, DateTime newDate) async {
    final query = _db.select(_db.tasks)..where((t) => t.id.equals(id));
    final rows = await query.get();
    if (rows.isEmpty) return;
    final existing = _toDomain(rows.single);
    await _db.upsertTask(
      _toCompanion(existing.copyWith(date: newDate, updatedAt: DateTime.now())),
    );
  }

  // — mapping —
  Task _toDomain(TaskRow r) => Task(
        id: r.id,
        title: r.title,
        date: fromEpochDay(r.date),
        isDone: r.isDone,
        colorSetId: r.colorSetId,
        sortOrder: r.sortOrder,
        createdAt: fromEpochMillis(r.createdAt),
        updatedAt: fromEpochMillis(r.updatedAt),
        deviceId: r.deviceId,
      );

  TasksCompanion _toCompanion(Task t) => TasksCompanion(
        id: Value(t.id),
        title: Value(t.title),
        date: Value(toEpochDay(t.date)),
        isDone: Value(t.isDone),
        colorSetId: Value(t.colorSetId),
        sortOrder: Value(t.sortOrder),
        createdAt: Value(toEpochMillis(t.createdAt)),
        updatedAt: Value(toEpochMillis(DateTime.now())),
        deviceId: Value(deviceId),
      );
}
