import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/drift_task_repository.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase db;
  late DriftTaskRepository repo;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = DriftTaskRepository(db, deviceId: 'device-test');
  });
  tearDown(() => db.close());

  Task t(
    String id,
    String title,
    DateTime date, {
    bool done = false,
    double sort = 0.0,
  }) => Task(
    id: id,
    title: title,
    date: date,
    isDone: done,
    colorSetId: null,
    sortOrder: sort,
    createdAt: DateTime(2026, 7, 7, 9),
    updatedAt: DateTime(2026, 7, 7, 9),
    deviceId: 'device-test',
  );

  test('upsert + tasksForDate returns task', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 7)));
    final list = await repo.tasksForDate(DateTime(2026, 7, 7));
    expect(list.map((e) => e.id), ['1']);
  });

  test('tasksInRange covers inclusive boundaries', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 6)));
    await repo.upsertTask(t('2', 'B', DateTime(2026, 7, 8)));
    final list = await repo.tasksInRange(DateTime(2026, 7, 6), DateTime(2026, 7, 8));
    expect(list.length, 2);
  });

  test('overdueBefore returns only not-done past tasks', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 5), done: false));
    await repo.upsertTask(t('2', 'B', DateTime(2026, 7, 5), done: true));
    final overdue = await repo.overdueBefore(DateTime(2026, 7, 7));
    expect(overdue.map((e) => e.id), ['1']);
  });

  test('moveTask updates date', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 7)));
    await repo.moveTask('1', DateTime(2026, 7, 9));
    final onOld = await repo.tasksForDate(DateTime(2026, 7, 7));
    final onNew = await repo.tasksForDate(DateTime(2026, 7, 9));
    expect(onOld, isEmpty);
    expect(onNew.map((e) => e.id), ['1']);
  });

  test('deleteTask removes entry', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 7)));
    await repo.deleteTask('1');
    expect(await repo.tasksForDate(DateTime(2026, 7, 7)), isEmpty);
  });

  test('upsert sets deviceId from repo', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 7)));
    final list = await repo.tasksForDate(DateTime(2026, 7, 7));
    expect(list.single.deviceId, 'device-test');
    expect(list.single.updatedAt, isNotNull);
  });
}
