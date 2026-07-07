import 'package:daily_planner/domain/models.dart';

/// Контракт, который реализует слой данных (Drift).
/// UI зависит от этого интерфейса, а не от Drift — это позволяет
/// подменять реализацию в тестах и изолировать UI от БД.
abstract class TaskRepository {
  /// Все задачи на конкретный день.
  Future<List<Task>> tasksForDate(DateTime date);

  /// Все задачи в диапазоне [start, end] включительно (по полуночи даты).
  Future<List<Task>> tasksInRange(DateTime start, DateTime end);

  /// Все невыполненные задачи строго до [date] (для авто-переноса).
  Future<List<Task>> overdueBefore(DateTime date);

  /// Вставить или обновить задачу (по id).
  Future<void> upsertTask(Task task);

  /// Удалить задачу по id.
  Future<void> deleteTask(String id);

  /// Перенести задачу на новую дату.
  Future<void> moveTask(String id, DateTime newDate);
}
