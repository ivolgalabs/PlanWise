import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/device_id.dart';
import 'package:daily_planner/data/drift_task_repository.dart';
import 'package:daily_planner/data/seed_color_sets.dart';
import 'package:daily_planner/domain/task_repository.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Единственный экземпляр Drift-БД на всё приложение.
final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

/// Device UUID (генерируется при первом запуске).
final deviceIdProvider = FutureProvider<String>((ref) async {
  return getDeviceId();
});

/// Репозиторий задач. Зависит от БД и device-id.
final taskRepositoryProvider = FutureProvider<TaskRepository>((ref) async {
  final db = ref.watch(databaseProvider);
  final deviceId = await ref.watch(deviceIdProvider.future);
  await seedDefaultColorSets(db); // идемпотентно
  return DriftTaskRepository(db, deviceId: deviceId);
});
