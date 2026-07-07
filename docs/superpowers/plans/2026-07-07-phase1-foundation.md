# Фаза 1, Часть 1: Окружение + фундамент проекта + модель данных

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять Flutter-окружение на машине, создать скелет проекта ежедневника, подключить локальную БД Drift и реализовать репозиторий задач с тестами.

**Architecture:** Flutter-приложение со структурой `feature-first`. Доменный слой (`lib/domain`) — чистые Dart-модели без зависимости от Flutter/Drift. Слой данных (`lib/data`) — Drift-БД и репозиторий, реализующий доменный интерфейс. UI (`lib/ui`) — не входит в эту часть.

**Tech Stack:** Flutter 3.x (stable), Dart 3.x, Drift (SQLite), riverpod, uuid, intl. Тестирование — `flutter_test` + `drift_dev` (NativeDatabase в тестах через in-memory).

**Окружение машины (важно):** macOS arm64, Homebrew установлен, Rust 1.96 есть, **Flutter/Dart/Android SDK/Java — отсутствуют**. План начинается с их установки.

---

## Файловая структура (что создаём в этой части)

```
todo/
├── pubspec.yaml                      # зависимости проекта
├── analysis_options.yaml            # линтер
├── lib/
│   ├── main.dart                     # точка входа (заглушка, раскрыта в Части 2)
│   ├── domain/
│   │   ├── models.dart               # чистые Dart-модели: Task, ColorSet
│   │   └── task_repository.dart      # абстрактный интерфейс репозитория
│   ├── data/
│   │   ├── database/
│   │   │   ├── database.dart         # Drift-определение БД (@DriftDatabase)
│   │   │   ├── tables.dart           # Drift-таблицы: Tasks, ColorSets, Settings
│   │   │   └── type_converters.dart  # конвертеры LocalDate <-> int
│   │   ├── drift_task_repository.dart # реализация TaskRepository на Drift
│   │   └── device_id.dart            # генерация/чтение device UUID
│   └── core/
│       └── date_utils.dart           # утилиты дат (неделя, месяц)
└── test/
    ├── domain/
    │   ├── date_utils_test.dart
    │   └── task_model_test.dart
    └── data/
        ├── drift_task_repository_test.dart
        └── database_test.dart
```

Каждый файл — одна ответственность. Доменный слой не зависит от Drift (тестируется без БД). Репозиторий изолирует UI от БД.

---

## Task 1: Установка Flutter SDK и Android toolchain

**Files:**
- Modify: (окружение системы, не файлы проекта)

- [ ] **Step 1: Установить Flutter через Homebrew**

Run:
```bash
brew install --cask flutter
```
Expected: `flutter was successfully installed!`

- [ ] **Step 2: Проверить установку Flutter**

Run:
```bash
flutter --version
```
Expected: версия Flutter 3.x.x on darwin-arm64, channel stable.

- [ ] **Step 3: Запустить flutter doctor и зафиксировать проблемы**

Run:
```bash
flutter doctor -v
```
Expected: отметьте, какие пункты помечены `[✓]` / `[✗]`. На этом этапе `[✗] Android toolchain` — ожидаемо (Android SDK ещё не установлен).

- [ ] **Step 4: Установить Android Studio (с Android SDK и Java)**

Run:
```bash
brew install --cask android-studio
```
Expected: `android-studio was successfully installed!`

Android Studio включает Android SDK и совместимую JDK (Android Studio bundles JBR — JetBrains Runtime, удовлетворяет требованию Gradle). Дополнительно ставить систему Java не нужно.

- [ ] **Step 5: Принять лицензии Android SDK**

Открыть Android Studio один раз (GUI), чтобы оно завершило первичную настройку SDK, затем:
```bash
flutter doctor --android-licenses
```
Ожидается: нажать `y` для каждой лицензии. В конце `All SDK package licenses accepted`.

- [ ] **Step 6: Проверить, что flutter doctor зелёный по ключевым пунктам**

Run:
```bash
flutter doctor
```
Expected: `[✓] Flutter`, `[✓] Android toolchain`. `[!] Connected device` допустимо на этом этапе.

- [ ] **Step 7: Зафиксировать, что окружение готово**

Записать вывод `flutter doctor` в заметки — это бейзлайн окружения для проекта.

---

## Task 2: Создать Flutter-проект и базовую структуру

**Files:**
- Create: `pubspec.yaml` (через `flutter create`)
- Create: `lib/main.dart`
- Create: `analysis_options.yaml`
- Create: `.gitignore`

- [ ] **Step 1: Создать проект Flutter**

Из корня рабочей директории:
```bash
cd "/Users/ivolga/My Project/ZK_Project/todo"
flutter create --org com.zkproject --project-name daily_planner --platforms=android,macos,windows .
```
Expected: `All done!` Проект создан в текущей директории. Платформы android + macos + windows (desktop для Фазы 1).

- [ ] **Step 2: Проверить, что проект собирается и запускается (desktop smoke-test)**

Run:
```bash
flutter pub get
cd "/Users/ivolga/My Project/ZK_Project/todo"
flutter run -d macos
```
Expected: открывается окно с дефолтным счётчиком Flutter. Закрыть окно (Ctrl-C в терминале).

Если macOS desktop недоступен (нет Xcode full), пропустить — android-сборку проверим позже. Главное — `flutter pub get` прошёл без ошибок.

- [ ] **Step 3: Настроить analysis_options.yaml**

Записать в `analysis_options.yaml`:
```yaml
include: package:flutter_lints/flutter.yaml

linter:
  rules:
    prefer_single_quotes: true
    require_trailing_commas: true
    avoid_print: true

analyzer:
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"
```

- [ ] **Step 4: Инициализировать git (проект пока не под git)**

```bash
cd "/Users/ivolga/My Project/ZK_Project/todo"
git init
git add -A
git commit -m "chore: scaffold Flutter project (android, macos, windows)"
```
Expected: первый коммит создан.

---

## Task 3: Подключить зависимости (Drift, riverpod, uuid, intl)

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1: Добавить зависимости в pubspec.yaml**

Выполнить (из корня проекта):
```bash
flutter pub add drift flutter_riverpod riverpod_annotation uuid intl path_provider path_provider_android sqlite3_flutter_libs dev:drift_dev dev:build_runner dev:riverpod_generator
```
Expected: `Got dependencies!` В `pubspec.yaml` появились перечисленные пакеты.

- [ ] **Step 2: Проверить, что зависимости установлены**

Run:
```bash
flutter pub deps | grep -E "drift|riverpod|uuid|sqlite3_flutter_libs"
```
Expected: каждая из библиотек присутствует в списке.

- [ ] **Step 3: Закоммитить pubspec**

```bash
git add pubspec.yaml pubspec.lock
git commit -m "chore: add drift, riverpod, uuid, intl dependencies"
```

---

## Task 4: Доменные модели (чистый Dart, без Drift)

**Files:**
- Create: `lib/domain/models.dart`
- Test: `test/domain/task_model_test.dart`

- [ ] **Step 1: Написать failing-тест на модель Task и ColorSet**

Создать `test/domain/task_model_test.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Task', () {
    test('creates with required fields', () {
      final task = Task(
        id: 'task-1',
        title: 'Купить хлеб',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0.0,
        createdAt: DateTime(2026, 7, 7, 9),
        updatedAt: DateTime(2026, 7, 7, 9),
        deviceId: 'device-1',
      );
      expect(task.title, 'Купить хлеб');
      expect(task.isDone, isFalse);
      expect(task.colorSetId, isNull);
    });

    test('copyWith updates only given fields', () {
      final task = Task(
        id: 'task-1',
        title: 'A',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0.0,
        createdAt: DateTime(2026, 7, 7, 9),
        updatedAt: DateTime(2026, 7, 7, 9),
        deviceId: 'device-1',
      );
      final done = task.copyWith(isDone: true, title: 'A (done)');
      expect(done.isDone, isTrue);
      expect(done.title, 'A (done)');
      expect(done.id, 'task-1');
    });
  });

  group('ColorSet', () {
    test('creates with name and color', () {
      final set = ColorSet(id: 's1', name: 'Работа', color: 0xFFC9A87C, sortOrder: 1.0);
      expect(set.name, 'Работа');
      expect(set.color, 0xFFC9A87C);
    });
  });
}
```

- [ ] **Step 2: Запустить тест, убедиться, что он падает (классы не существуют)**

Run:
```bash
flutter test test/domain/task_model_test.dart
```
Expected: FAIL — `Target of URI doesn't exist: 'package:daily_planner/domain/models.dart'`.

- [ ] **Step 3: Реализовать модели в lib/domain/models.dart**

```dart
/// Чистые доменные модели. Не зависят от Drift/Flutter — тестируются без БД.
library;

/// Дата без времени: только год/месяц/день. Используем чистый DateTime
/// с обнуленным временем. Сравнение и хранение — по [millisecondsSinceEpoch]
/// полуночи. Для простоты MVP не вводим отдельный LocalDate-класс.
typedef LocalDate = DateTime;

DateTime localDate(int year, int month, int day) =>
    DateTime(year, month, day);

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
```

- [ ] **Step 4: Запустить тест, убедиться, что он проходит**

Run:
```bash
flutter test test/domain/task_model_test.dart
```
Expected: `All tests passed!`

- [ ] **Step 5: Закоммитить**

```bash
git add lib/domain/models.dart test/domain/task_model_test.dart
git commit -m "feat(domain): add Task and ColorSet models with tests"
```

---

## Task 5: Абстрактный интерфейс TaskRepository

**Files:**
- Create: `lib/domain/task_repository.dart`

- [ ] **Step 1: Описать интерфейс репозитория**

Создать `lib/domain/task_repository.dart`:
```dart
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
```

- [ ] **Step 2: Проверить анализом, что файл компилируется**

Run:
```bash
flutter analyze lib/domain/task_repository.dart
```
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/domain/task_repository.dart
git commit -m "feat(domain): add TaskRepository interface"
```

---

## Task 6: Утилиты дат (неделя, месяц)

**Files:**
- Create: `lib/core/date_utils.dart`
- Test: `test/domain/date_utils_test.dart`

- [ ] **Step 1: Написать failing-тесты на утилиты дат**

Создать `test/domain/date_utils_test.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart' as du;
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('startOfWeek', () {
    test('Monday is the first day of ISO week', () {
      // Среда 8 июля 2026
      final wed = DateTime(2026, 7, 8);
      expect(du.startOfWeek(wed, startWithMonday: true), DateTime(2026, 7, 6)); // Пн 6 июля
    });

    test('Sunday belongs to previous week when week starts Monday', () {
      final sun = DateTime(2026, 7, 5);
      expect(du.startOfWeek(sun, startWithMonday: true), DateTime(2026, 6, 29));
    });
  });

  group('weekDays', () {
    test('returns 7 consecutive days from start', () {
      final days = du.weekDays(DateTime(2026, 7, 8));
      expect(days.length, 7);
      expect(days.first, DateTime(2026, 7, 6));
      expect(days.last, DateTime(2026, 7, 12));
    });
  });

  group('isSameDay', () {
    test('ignores time component', () {
      expect(du.isSameDay(DateTime(2026, 7, 7, 9), DateTime(2026, 7, 7, 23)), isTrue);
      expect(du.isSameDay(DateTime(2026, 7, 7), DateTime(2026, 7, 8)), isFalse);
    });
  });
}
```

- [ ] **Step 2: Запустить тесты, убедиться, что падают**

Run:
```bash
flutter test test/domain/date_utils_test.dart
```
Expected: FAIL — файл не существует.

- [ ] **Step 3: Реализовать lib/core/date_utils.dart**

```dart
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
```

- [ ] **Step 4: Запустить тесты, убедиться, что проходят**

Run:
```bash
flutter test test/domain/date_utils_test.dart
```
Expected: `All tests passed!`

- [ ] **Step 5: Закоммитить**

```bash
git add lib/core/date_utils.dart test/domain/date_utils_test.dart
git commit -m "feat(core): add date utilities (week, isSameDay) with tests"
```

---

## Task 7: Drift-таблицы и определение БД

**Files:**
- Create: `lib/data/database/tables.dart`
- Create: `lib/data/database/type_converters.dart`
- Create: `lib/data/database/database.dart`

- [ ] **Step 1: Создать Drift-таблицы в lib/data/database/tables.dart**

```dart
import 'package:drift/drift.dart';

/// Таблица задач. Поле [date] хранится как epoch-day (int): количество дней
/// с 1970-01-01. Это даёт индексируемое, таймзоно-независимое сравнение дат.
class Tasks extends Table with AutoIncrementingStringPK {
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

/// Миксин не обязателен; оставляем для ясности, что PK — строковый id.
mixin AutoIncrementingStringPK on Table {}
```

- [ ] **Step 2: Создать конвертеры дат в lib/data/database/type_converters.dart**

```dart
import 'package:drift/drift.dart';

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

/// Конвертация DateTime <-> epoch-millis (UTC).
int toEpochMillis(DateTime dt) =>
    dt.toUtc().millisecondsSinceEpoch;

DateTime fromEpochMillis(int ms) =>
    DateTime.fromMillisecondsSinceEpoch(ms, isUtc: false).toLocal();
```

- [ ] **Step 3: Создать определение БД в lib/data/database/database.dart**

```dart
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3_flutter_libs/sqlite3_flutter_libs.dart';

import 'tables.dart';
import 'type_converters.dart';

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

  Future<List<TaskRow>> overdueBefore(int epochDay) =>
      (select(tasks)
            ..where((t) => t.date.isSmallerThanValue(epochDay) & t.isDone.equals(false)))
          .get();

  Future<void> upsertTask(TasksCompanion entry) => into(tasks).insertOnConflictUpdate(entry);

  Future<int> removeTask(String id) =>
      (delete(tasks)..where((t) => t.id.equals(id))).go();

  // — ColorSets —
  Future<List<ColorSetRow>> allColorSets() =>
      (select(colorSets)..orderBy([(c) => OrderingTerm.asc(c.sortOrder)])).get();

  Future<void> upsertColorSet(ColorSetsCompanion entry) =>
      into(colorSets).insertOnConflictUpdate(entry);
}

QueryExecutor _open() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'daily_planner.sqlite'));
    // На Android < 7 нужно явно настроить библиотеку sqlite3.
    await applyWorkaroundToOpenSqlite3OnOldAndroidVersions();
    return NativeDatabase.createInBackground(file, logStatements: false);
  });
}

/// Расширение, добавляющее удобный геттер [tasks]/[colorSets] — генерируется drift.
/// (типы TaskRow, ColorSetsCompanion и пр. тоже генерируются.)
```

- [ ] **Step 4: Сгенерировать код Drift**

Run:
```bash
dart run build_runner build --delete-conflicting-outputs
```
Expected: `build_runner` завершается `Succeeded after ...` и создаёт `lib/data/database/database.g.dart`.

- [ ] **Step 5: Проверить анализом, что БД-код валиден**

Run:
```bash
flutter analyze lib/data/database/
```
Expected: `No issues found!` (если `_$AppDatabase`, `TaskRow` и пр. сгенерированы корректно).

- [ ] **Step 6: Закоммитить**

```bash
git add lib/data/database/ pubspec.yaml pubspec.lock
git commit -m "feat(data): add Drift database schema (tasks, color_sets, settings)"
```

---

## Task 8: Реализация DriftTaskRepository + сидинг дефолтных сетов

**Files:**
- Create: `lib/data/drift_task_repository.dart`
- Create: `lib/data/device_id.dart`
- Test: `test/data/drift_task_repository_test.dart`

- [ ] **Step 1: Написать failing-тест на репозиторий (с in-memory БД)**

Создать `test/data/drift_task_repository_test.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
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

  Task t(String id, String title, DateTime date, {bool done = false, double sort = 0.0}) =>
      Task(
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

  test('upsert sets updatedAt and deviceId from repo', () async {
    await repo.upsertTask(t('1', 'A', DateTime(2026, 7, 7)));
    final list = await repo.tasksForDate(DateTime(2026, 7, 7));
    expect(list.single.deviceId, 'device-test');
    expect(list.single.updatedAt, isNotNull);
  });
}
```

- [ ] **Step 2: Запустить тест, убедиться, что падает (DriftTaskRepository не существует)**

Run:
```bash
flutter test test/data/drift_task_repository_test.dart
```
Expected: FAIL — `Target of URI doesn't exist`.

- [ ] **Step 3: Реализовать device_id генератор в lib/data/device_id.dart**

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Получить стабильный device UUID. При первом вызове генерируется и
/// сохраняется в flutter_secure_storage. Используется как CRDT actor_id.
///
/// В тестах — инжектируем фиктивный id напрямую через репозиторий.
Future<String> getDeviceId({FlutterSecureStorage? storage}) async {
  final s = storage ?? const FlutterSecureStorage();
  final existing = await s.read(key: _key);
  if (existing != null) return existing;
  final id = const Uuid().v4();
  await s.write(key: _key, value: id);
  return id;
}

const _key = 'device_id';
```

Добавить `flutter_secure_storage` в зависимости:
```bash
flutter pub add flutter_secure_storage
```

- [ ] **Step 4: Реализовать DriftTaskRepository в lib/data/drift_task_repository.dart**

```dart
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
    final rows = await (_db.select(_db.tasks)..where((t) => t.id.equals(id))).get();
    if (rows.isEmpty) return;
    final existing = _toDomain(rows.single);
    await _db.upsertTask(_toCompanion(existing.copyWith(
      date: newDate,
      updatedAt: DateTime.now(),
    )));
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
```

- [ ] **Step 5: Запустить тест, убедиться, что проходит**

Run:
```bash
flutter test test/data/drift_task_repository_test.dart
```
Expected: `All tests passed!`

- [ ] **Step 6: Закоммитить**

```bash
git add lib/data/drift_task_repository.dart lib/data/device_id.dart pubspec.yaml pubspec.lock test/data/drift_task_repository_test.dart
git commit -m "feat(data): implement DriftTaskRepository with device-id + tests"
```

---

## Task 9: Сидинг дефолтных наборов цветов при первом запуске

**Files:**
- Create: `lib/data/seed_color_sets.dart`
- Test: `test/data/database_test.dart`

- [ ] **Step 1: Написать failing-тест на сидинг**

Создать `test/data/database_test.dart`:
```dart
import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/seed_color_sets.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('seedDefaultColorSets inserts 4 defaults if empty', () async {
    await seedDefaultColorSets(db);
    final all = await db.allColorSets();
    expect(all.length, 4);
    expect(all.map((c) => c.name), containsAll(['Без категории', 'Работа', 'Личное', 'Спорт']));
  });

  test('seedDefaultColorSets is idempotent', () async {
    await seedDefaultColorSets(db);
    await seedDefaultColorSets(db);
    final all = await db.allColorSets();
    expect(all.length, 4);
  });
}
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run:
```bash
flutter test test/data/database_test.dart
```
Expected: FAIL — `seed_color_sets.dart` не существует.

- [ ] **Step 3: Реализовать lib/data/seed_color_sets.dart**

```dart
import 'package:drift/drift.dart';

import 'database/database.dart';

/// Дефолтные наборы цветов (создаются при первом запуске).
/// Цвета — ARGB. Акцент проекта: терракотовый #C9A87C.
const _defaults = <_DefaultSet>[
  _DefaultSet('cs-none', 'Без категории', 0xFFF0ECE2, 0.0),
  _DefaultSet('cs-work', 'Работа', 0xFFC9A87C, 1.0),
  _DefaultSet('cs-personal', 'Личное', 0xFF7EB8C4, 2.0),
  _DefaultSet('cs-sport', 'Спорт', 0xFFE8A87C, 3.0),
];

class _DefaultSet {
  const _DefaultSet(this.id, this.name, this.color, this.sortOrder);
  final String id;
  final String name;
  final int color;
  final double sortOrder;
}

/// Вставляет дефолтные сеты, если таблица пуста. Идемпотентно.
Future<void> seedDefaultColorSets(AppDatabase db) async {
  final existing = await db.allColorSets();
  if (existing.isNotEmpty) return;
  for (final d in _defaults) {
    await db.upsertColorSet(ColorSetsCompanion.insert(
      id: d.id,
      name: d.name,
      color: Value(d.color),
      sortOrder: Value(d.sortOrder),
    ));
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run:
```bash
flutter test test/data/database_test.dart
```
Expected: `All tests passed!`

- [ ] **Step 5: Запустить полный набор тестов**

Run:
```bash
flutter test
```
Expected: `All tests passed!` (все доменные + data-тесты зелёные).

- [ ] **Step 6: Закоммитить**

```bash
git add lib/data/seed_color_sets.dart test/data/database_test.dart
git commit -m "feat(data): seed default color sets on first run with idempotency test"
```

---

## Task 10: Riverpod-провайдеры и точка входа (заглушка для UI)

**Files:**
- Create: `lib/data/providers.dart`
- Modify: `lib/main.dart`

- [ ] **Step 1: Создать провайдеры в lib/data/providers.dart**

```dart
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
```

- [ ] **Step 2: Заменить lib/main.dart на заглушку с ProviderScope**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: DailyPlannerApp()));
}

class DailyPlannerApp extends StatelessWidget {
  const DailyPlannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ежедневник',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFC9A87C)),
        scaffoldBackgroundColor: const Color(0xFFFAF7F0),
      ),
      home: const Scaffold(
        body: Center(child: Text('Ежедневник — Фаза 1 (фундамент готов)')),
      ),
    );
  }
}
```

- [ ] **Step 3: Проверить анализом весь lib/**

Run:
```bash
flutter analyze
```
Expected: `No issues found!`

- [ ] **Step 4: Smoke-запуск на desktop или android**

Run:
```bash
flutter run -d macos
```
Expected: окно открывается с фоновым цветом и текстом-заглушкой. Если macOS недоступен — собрать APK без запуска: `flutter build apk --debug` должно завершиться `Built build/app/outputs/...`.

- [ ] **Step 5: Закоммитить**

```bash
git add lib/data/providers.dart lib/main.dart
git commit -m "feat(app): wire riverpod providers + entry point stub"
```

---

## Границы этой части (Часть 1)

✅ Сделано в этой части:
- Окружение (Flutter, Android SDK) поднято
- Скелет проекта + зависимости
- Доменные модели Task / ColorSet (чистый Dart)
- Интерфейс TaskRepository
- Утилиты дат
- Drift-БД (tasks, color_sets, settings)
- DriftTaskRepository + device UUID
- Сидинг дефолтных сетов цветов
- Riverpod-провайдеры + точка входа
- Тесты на все слои

❌ НЕ сделано (следующие части):
- UI: виды День / Неделя / Месяц, переключатель, мини-календарь (Часть 2)
- Drag-and-drop задач между днями (Часть 3)
- Авто-перенос невыполненных задач (Часть 4)
- Темы (paper-white / тёмная / холодная) (Часть 4)

---

## Финальная проверка части

- [ ] **Запустить весь набор тестов — всё зелёное**

Run:
```bash
flutter test
```
Expected: `All tests passed!`

- [ ] **Проверить анализом**

Run:
```bash
flutter analyze
```
Expected: `No issues found!`

- [ ] **Собрать release-APK (smoke, без запуска)**

Run:
```bash
flutter build apk --debug
```
Expected: `Built build/app/outputs/flutter-apk/app-debug.apk`.
