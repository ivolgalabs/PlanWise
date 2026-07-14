import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/device_id.dart';
import 'package:daily_planner/data/drift_task_repository.dart';
import 'package:daily_planner/data/seed_color_sets.dart';
import 'package:daily_planner/domain/models.dart';
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

/// Виды календаря.
enum CalendarView { day, week, month }

/// Текущий выбранный день (фокус навигации) — riverpod 3.x Notifier.
class SelectedDateNotifier extends Notifier<DateTime> {
  @override
  DateTime build() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  void set(DateTime value) => state = value;
}

final selectedDateProvider =
    NotifierProvider<SelectedDateNotifier, DateTime>(SelectedDateNotifier.new);

/// Выбранный вид (День/Неделя/Месяц).
class CalendarViewNotifier extends Notifier<CalendarView> {
  @override
  CalendarView build() => CalendarView.week;

  void set(CalendarView value) => state = value;
}

final calendarViewProvider =
    NotifierProvider<CalendarViewNotifier, CalendarView>(
        CalendarViewNotifier.new);

/// Реактивный список задач в диапазоне дат.
/// Использует StreamNotifierProvider.family, чтобы дождаться репозиторий.
final tasksInRangeProvider =
    StreamProvider.family<List<Task>, (DateTime, DateTime)>(
  (ref, range) async* {
    final repo = await ref.watch(taskRepositoryProvider.future);
    yield* repo.watchTasksInRange(range.$1, range.$2);
  },
);

/// Все сеты цветов (реактивно).
final colorSetsProvider = StreamProvider<List<ColorSetRow>>((ref) {
  final db = ref.watch(databaseProvider);
  return db.watchColorSets();
});
