import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'tables.dart';

part 'database.g.dart';

@DriftDatabase(tables: [Tasks, ColorSets, Settings])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_open());
  AppDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 1;

  // — Tasks —
  Future<List<TaskRow>> tasksForEpochDay(int epochDay) =>
      (select(tasks)..where((t) => t.date.equals(epochDay))).get();

  Future<List<TaskRow>> tasksInRange(int startDay, int endDay) =>
      (select(tasks)
            ..where((t) => t.date.isBetweenValues(startDay, endDay))
            ..orderBy([(t) => OrderingTerm.asc(t.sortOrder)]))
          .get();

  // — Tasks (reactive) —
  Stream<List<TaskRow>> watchTasksInRange(int startDay, int endDay) =>
      (select(tasks)
            ..where((t) => t.date.isBetweenValues(startDay, endDay))
            ..orderBy([(t) => OrderingTerm.asc(t.sortOrder)]))
          .watch();

  Stream<List<ColorSetRow>> watchColorSets() =>
      (select(colorSets)..orderBy([(c) => OrderingTerm.asc(c.sortOrder)]))
          .watch();

  Future<List<TaskRow>> overdueBefore(int epochDay) => (select(tasks)
        ..where(
          (t) => t.date.isSmallerThanValue(epochDay) & t.isDone.equals(false),
        ))
      .get();

  Future<void> upsertTask(TasksCompanion entry) =>
      into(tasks).insertOnConflictUpdate(entry);

  Future<int> removeTask(String id) =>
      (delete(tasks)..where((t) => t.id.equals(id))).go();

  // — ColorSets —
  Future<List<ColorSetRow>> allColorSets() => (select(colorSets)
        ..orderBy([(c) => OrderingTerm.asc(c.sortOrder)]))
      .get();

  Future<void> upsertColorSet(ColorSetsCompanion entry) =>
      into(colorSets).insertOnConflictUpdate(entry);
}

QueryExecutor _open() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'daily_planner.sqlite'));
    return NativeDatabase(file, logStatements: false);
  });
}
