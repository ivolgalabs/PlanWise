# Фаза 1, Часть 2: UI — виды День/Неделя/Месяц + переключатель + мини-календарь

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить главный экран ежедневника с тремя видами (День/Неделя/Месяц), переключателем между ними и мини-календарем с индикатором занятости дней. Создание/редактирование/удаление задач через UI.

**Architecture:** Feature-first структура. `lib/ui/` содержит экраны и виджеты. UI читает задачи через `taskRepositoryProvider` (Riverpod), реактивно — через `Stream`-провайдеры поверх Drift. Виджеты — чистые и тестируемые (widget-тесты). Навигация — `go_router` (минимально: один экран пока).

**Tech Stack:** Flutter, flutter_riverpod, drift (stream-запросы), intl (форматирование дат).

**Зависит от:** Часть 1 (доменные модели, DriftTaskRepository, провайдеры) — готова.

---

## Файловая структура (что создаём)

```
lib/
├── ui/
│   ├── theme/
│   │   └── app_colors.dart           # палитра tweek-style (бумажный фон, акценты)
│   ├── calendar/
│   │   ├── mini_calendar.dart        # мини-календарь месяца с индикатором занятости
│   │   └── month_grid.dart           # большая сетка месяца (вид «Месяц»)
│   ├── task/
│   │   ├── task_card.dart            # карточка одной задачи (чекбокс + цвет + текст)
│   │   ├── task_editor_sheet.dart    # bottom-sheet создания/редактирования задачи
│   │   └── day_column.dart           # колонка одного дня (список карточек)
│   └── planner/
│       ├── planner_screen.dart       # главный экран (шапка + переключатель видов)
│       ├── day_view.dart             # вид «День»
│       ├── week_view.dart            # вид «Неделя» (горизонтально 7 колонок)
│       ├── week_view_vertical.dart   # вид «Неделя» (вертикальный список дней)
│       └── month_view.dart           # вид «Месяц» (делегирует в month_grid)
├── data/
│   └── providers.dart                # Modify: добавить stream-провайдеры задач
└── main.dart                         # Modify: подключить planner_screen
test/
└── ui/
    ├── task_card_test.dart
    ├── mini_calendar_test.dart
    └── week_view_test.dart
```

---

## Task 1: Палитра приложения (app_colors)

**Files:**
- Create: `lib/ui/theme/app_colors.dart`

- [ ] **Step 1: Создать палитру**

```dart
/// Цветовая палитра ежедневника в стиле tweek.so.
/// Бумажный бежевый фон, тёплые акценты.
import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  /// Фон-бумага.
  static const paper = Color(0xFFFAF7F0);
  static const card = Color(0xFFFFFFFF);
  static const cardBorder = Color(0xFFE8E2D4);
  static const muted = Color(0xFF9A8F7A);
  static const text = Color(0xFF5A5240);
  static const doneOverlay = Color(0xFFF0ECE2);

  /// Акцент — терракотовый.
  static const accent = Color(0xFFC9A87C);

  /// Сеты по умолчанию (ARGB).
  static const setNone = Color(0xFFF0ECE2);
  static const setWork = Color(0xFFC9A87C);
  static const setPersonal = Color(0xFF7EB8C4);
  static const setSport = Color(0xFFE8A87C);

  /// Карта id сета -> цвет для UI (быстрый lookup).
  static const setColors = <String, Color>{
    'cs-none': setNone,
    'cs-work': setWork,
    'cs-personal': setPersonal,
    'cs-sport': setSport,
  };

  /// Цвет сета по id (fallback на setNone).
  static Color colorForSet(String? colorSetId) =>
      setColors[colorSetId] ?? setNone;
}
```

- [ ] **Step 2: Проверить анализом**

Run: `flutter analyze lib/ui/theme/`
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/ui/theme/app_colors.dart
git commit -m "feat(ui): add tweek-style color palette"
```

---

## Task 2: Stream-провайдеры задач (реактивный слой для UI)

**Files:**
- Modify: `lib/data/database/database.dart` (добавить `watchTasksInRange`)
- Modify: `lib/domain/task_repository.dart` (добавить `watchTasksInRange`)
- Modify: `lib/data/drift_task_repository.dart` (реализовать)
- Modify: `lib/data/providers.dart` (добавить провайдеры)

- [ ] **Step 1: Добавить stream-запрос в Drift-БД**

В `lib/data/database/database.dart`, в класс `AppDatabase` добавить после `tasksInRange`:

```dart
  // — Tasks (reactive) —
  Stream<List<TaskRow>> watchTasksInRange(int startDay, int endDay) =>
      (select(tasks)
            ..where((t) => t.date.isBetweenValues(startDay, endDay))
            ..orderBy([(t) => OrderingTerm.asc(t.sortOrder)]))
          .watch();

  Stream<List<ColorSetRow>> watchColorSets() =>
      (select(colorSets)..orderBy([(c) => OrderingTerm.asc(c.sortOrder)]))
          .watch();
```

- [ ] **Step 2: Добавить метод в TaskRepository**

В `lib/domain/task_repository.dart`, добавить в интерфейс:

```dart
  /// Реактивно: все задачи в диапазоне [start, end] включительно.
  Stream<List<Task>> watchTasksInRange(DateTime start, DateTime end);
```

- [ ] **Step 3: Реализовать в DriftTaskRepository**

В `lib/data/drift_task_repository.dart`, добавить в класс:

```dart
  @override
  Stream<List<Task>> watchTasksInRange(DateTime start, DateTime end) {
    return _db
        .watchTasksInRange(toEpochDay(start), toEpochDay(end))
        .map((rows) => rows.map(_toDomain).toList());
  }
```

- [ ] **Step 4: Добавить провайдеры задач в providers.dart**

В `lib/data/providers.dart`, добавить в конец:

```dart
/// Текущий выбранный день (фокус навигации).
final selectedDateProvider = StateProvider<DateTime>((ref) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day);
});

/// Выбранный вид (День/Неделя/Месяц).
final calendarViewProvider = StateProvider<CalendarView>((ref) => CalendarView.week);

/// Виды календаря.
enum CalendarView { day, week, month }

/// Реактивный список задач в диапазоне дат.
final tasksInRangeProvider =
    StreamProvider.family<List<Task>, (DateTime, DateTime)>((ref, range) async {
  final repo = await ref.watch(taskRepositoryProvider.future);
  return repo.watchTasksInRange(range.$1, range.$2);
});

/// Все сеты цветов (реактивно).
final colorSetsProvider = StreamProvider<List<ColorSetRow>>((ref) async* {
  // Используем БД напрямую: репозиторий задач не отдаёт color_sets.
  final db = ref.watch(databaseProvider);
  yield* db.watchColorSets();
});
```

Также добавить импорты в начало `providers.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
```

- [ ] **Step 5: Проверить анализом**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 6: Закоммитить**

```bash
git add lib/
git commit -m "feat(data): add reactive stream providers for tasks and color sets"
```

---

## Task 3: Карточка задачи (task_card) + widget-тест

**Files:**
- Create: `lib/ui/task/task_card.dart`
- Test: `test/ui/task_card_test.dart`

- [ ] **Step 1: Написать widget-тест**

Создать `test/ui/task_card_test.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Task task({bool done = false, String? setId, String title = 'Купить хлеб'}) =>
      Task(
        id: 't1',
        title: title,
        date: DateTime(2026, 7, 7),
        isDone: done,
        colorSetId: setId,
        sortOrder: 0,
        createdAt: DateTime(2026, 7, 7),
        updatedAt: DateTime(2026, 7, 7),
        deviceId: 'd1',
      );

  testWidgets('shows title', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: TaskCard(task: task())),
    ));
    expect(find.text('Купить хлеб'), findsOneWidget);
  });

  testWidgets('tapping checkbox calls onToggle', (tester) async {
    bool? toggled;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: TaskCard(task: task(), onToggle: () => toggled = true),
      ),
    ));
    await tester.tap(find.byType(Checkbox));
    expect(toggled, isTrue);
  });

  testWidgets('done task is struck through', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: TaskCard(task: task(done: true))),
    ));
    final text = tester.widget<Text>(find.text('Купить хлеб'));
    expect(text.style?.decoration, TextDecoration.lineThrough);
  });
}
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `flutter test test/ui/task_card_test.dart`
Expected: FAIL — `TaskCard` не существует.

- [ ] **Step 3: Реализовать TaskCard**

Создать `lib/ui/task/task_card.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Карточка одной задачи. Чекбокс выполнено + цветной маркер сета + текст.
class TaskCard extends StatelessWidget {
  const TaskCard({
    required this.task,
    this.onToggle,
    this.onTap,
    super.key,
  });

  final Task task;
  final VoidCallback? onToggle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final setColor = AppColors.colorForSet(task.colorSetId);
    return Material(
      color: task.isDone ? AppColors.doneOverlay : setColor,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: Checkbox(
                  value: task.isDone,
                  onChanged: onToggle == null ? null : (_) => onToggle!(),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  task.title,
                  style: TextStyle(
                    fontSize: 13,
                    color: task.isDone ? AppColors.muted : AppColors.text,
                    decoration:
                        task.isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `flutter test test/ui/task_card_test.dart`
Expected: `All tests passed!`

- [ ] **Step 5: Закоммитить**

```bash
git add lib/ui/task/task_card.dart test/ui/task_card_test.dart
git commit -m "feat(ui): add TaskCard widget with checkbox, color set, strikethrough"
```

---

## Task 4: Колонка дня (day_column)

**Files:**
- Create: `lib/ui/task/day_column.dart`

- [ ] **Step 1: Реализовать DayColumn**

Создать `lib/ui/task/day_column.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Колонка одного дня: заголовок (день недели + число) + список карточек задач.
/// Подсветка, если [day] — сегодня.
class DayColumn extends StatelessWidget {
  const DayColumn({
    required this.day,
    required this.tasks,
    this.onToggle,
    this.onAdd,
    this.onTaskTap,
    super.key,
  });

  final DateTime day;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final VoidCallback? onAdd;
  final void Function(Task task)? onTaskTap;

  bool get _isToday => isSameDay(day, DateTime.now());

  @override
  Widget build(BuildContext context) {
    final weekday = DateFormat.E('ru').format(day);
    final dayNum = DateFormat('d').format(day);
    return Container(
      decoration: BoxDecoration(
        color: AppColors.card,
        border: Border.all(
          color: _isToday ? AppColors.accent : AppColors.cardBorder,
          width: _isToday ? 2 : 1,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
            child: Row(
              children: [
                Text(
                  weekday,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: _isToday ? AppColors.accent : AppColors.muted,
                  ),
                ),
                if (_isToday) ...[
                  const SizedBox(width: 4),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ],
                const Spacer(),
                Text(
                  dayNum,
                  style: TextStyle(
                    fontSize: 10,
                    color: _isToday ? AppColors.accent : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.cardBorder),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(4),
              children: [
                for (final t in tasks)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: TaskCard(
                      task: t,
                      onToggle: onToggle == null ? null : () => onToggle!(t),
                      onTap: onTaskTap == null ? null : () => onTaskTap!(t),
                    ),
                  ),
              ],
            ),
          ),
          if (onAdd != null)
            IconButton(
              icon: const Icon(Icons.add, size: 18, color: AppColors.muted),
              onPressed: onAdd,
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Проверить анализом**

Run: `flutter analyze lib/ui/task/day_column.dart`
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/ui/task/day_column.dart
git commit -m "feat(ui): add DayColumn with today-highlight and task list"
```

---

## Task 5: Sheet редактирования задачи (task_editor_sheet)

**Files:**
- Create: `lib/ui/task/task_editor_sheet.dart`

- [ ] **Step 1: Реализовать TaskEditorSheet**

Создать `lib/ui/task/task_editor_sheet.dart`:
```dart
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Bottom-sheet для создания/редактирования задачи.
/// Возвращает ({title, colorSetId}) или null при отмене.
class TaskEditorSheet extends StatefulWidget {
  const TaskEditorSheet({
    this.initialTitle = '',
    this.initialColorSetId,
    super.key,
  });

  final String initialTitle;
  final String? initialColorSetId;

  @override
  State<TaskEditorSheet> createState() => _TaskEditorSheetState();
}

class _TaskEditorSheetState extends State<TaskEditorSheet> {
  late final TextEditingController _title;
  String? _colorSetId;

  static const _sets = <(String, String, Color)>[
    ('cs-none', 'Без категории', AppColors.setNone),
    ('cs-work', 'Работа', AppColors.setWork),
    ('cs-personal', 'Личное', AppColors.setPersonal),
    ('cs-sport', 'Спорт', AppColors.setSport),
  ];

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: widget.initialTitle);
    _colorSetId = widget.initialColorSetId;
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _save() {
    final title = _title.text.trim();
    if (title.isEmpty) return;
    Navigator.of(context).pop((title: title, colorSetId: _colorSetId));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _title,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Новая задача',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _save(),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [
              for (final (id, label, color) in _sets)
                ChoiceChip(
                  label: Text(label),
                  avatar: CircleAvatar(backgroundColor: color, radius: 6),
                  selected: _colorSetId == id,
                  onSelected: (_) => setState(() => _colorSetId = id),
                ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _save,
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Проверить анализом**

Run: `flutter analyze lib/ui/task/task_editor_sheet.dart`
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/ui/task/task_editor_sheet.dart
git commit -m "feat(ui): add TaskEditorSheet for create/edit with color sets"
```

---

## Task 6: Мини-календарь (mini_calendar) с индикатором занятости

**Files:**
- Create: `lib/ui/calendar/mini_calendar.dart`
- Test: `test/ui/mini_calendar_test.dart`

- [ ] **Step 1: Написать widget-тест на логику занятости**

Создать `test/ui/mini_calendar_test.dart`:
```dart
import 'package:daily_planner/ui/calendar/mini_calendar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('busyLevel', () {
    test('0 tasks => free', () {
      expect(busyLevel(0), BusyLevel.free);
    });
    test('1-2 tasks => light', () {
      expect(busyLevel(1), BusyLevel.light);
      expect(busyLevel(2), BusyLevel.light);
    });
    test('3+ tasks => heavy', () {
      expect(busyLevel(3), BusyLevel.heavy);
      expect(busyLevel(10), BusyLevel.heavy);
    });
  });

  testWidgets('mini calendar renders weekday header', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: MiniCalendar(
          month: DateTime(2026, 7, 1),
          busyByDay: const {},
          selectedDay: DateTime(2026, 7, 2),
          onDaySelected: (_) {},
        ),
      ),
    ));
    expect(find.text('Июль 2026'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Запустить, убедиться, что падёт**

Run: `flutter test test/ui/mini_calendar_test.dart`
Expected: FAIL — `MiniCalendar`/`busyLevel` не существуют.

- [ ] **Step 3: Реализовать MiniCalendar**

Создать `lib/ui/calendar/mini_calendar.dart`:
```dart
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Уровень занятости дня для индикатора в мини-календаре.
enum BusyLevel { free, light, heavy }

/// Подсчёт уровня занятости по количеству задач.
BusyLevel busyLevel(int count) {
  if (count == 0) return BusyLevel.free;
  if (count <= 2) return BusyLevel.light;
  return BusyLevel.heavy;
}

/// Мини-календарь месяца с индикатором занятости дней.
/// [busyByDay] — карта: дата (полночь) -> число задач.
class MiniCalendar extends StatelessWidget {
  const MiniCalendar({
    required this.month,
    required this.busyByDay,
    required this.selectedDay,
    required this.onDaySelected,
    super.key,
  });

  /// Любой день нужного месяца.
  final DateTime month;
  final Map<DateTime, int> busyByDay;
  final DateTime selectedDay;
  final ValueChanged<DateTime> onDaySelected;

  DateTime get _firstOfMonth => DateTime(month.year, month.month, 1);

  @override
  Widget build(BuildContext context) {
    final firstDisplay = _firstOfMonth.subtract(
      Duration(days: (_firstOfMonth.weekday - 1) % 7),
    );
    final monthTitle = DateFormat.yMMMM('ru').format(_firstOfMonth);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.card,
        border: Border.all(color: AppColors.cardBorder),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${monthTitle[0].toUpperCase()}${monthTitle.substring(1)}',
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.text,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final w in const ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'])
                Expanded(
                  child: Center(
                    child: Text(
                      w,
                      style: const TextStyle(
                        fontSize: 8,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
            childAspectRatio: 1,
            children: [
              for (int i = 0; i < 42; i++)
                _dayCell(firstDisplay.add(Duration(days: i))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dayCell(DateTime day) {
    final inMonth = day.month == _firstOfMonth.month;
    final key = DateTime(day.year, day.month, day.day);
    final isSelected = key == DateTime(selectedDay.year, selectedDay.month, selectedDay.day);
    final level = busyByDay[key] ?? 0;
    final busy = busyLevel(level);

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onDaySelected(key),
      child: Container(
        decoration: BoxDecoration(
          color: isSelected ? AppColors.accent.withValues(alpha: 0.15) : null,
          borderRadius: BorderRadius.circular(4),
        ),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${day.day}',
              style: TextStyle(
                fontSize: 9,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: inMonth
                    ? (isSelected ? AppColors.accent : AppColors.text)
                    : AppColors.muted.withValues(alpha: 0.4),
              ),
            ),
            const SizedBox(height: 1),
            _busyIndicator(busy),
          ],
        ),
      ),
    );
  }

  Widget _busyIndicator(BusyLevel level) {
    switch (level) {
      case BusyLevel.free:
        return const SizedBox(height: 3);
      case BusyLevel.light:
        return Container(
          width: 3,
          height: 3,
          decoration: const BoxDecoration(
            color: AppColors.accent,
            shape: BoxShape.circle,
          ),
        );
      case BusyLevel.heavy:
        return Container(
          width: 10,
          height: 3,
          decoration: BoxDecoration(
            color: AppColors.setSport,
            borderRadius: BorderRadius.circular(2),
          ),
        );
    }
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `flutter test test/ui/mini_calendar_test.dart`
Expected: `All tests passed!`

- [ ] **Step 5: Закоммитить**

```bash
git add lib/ui/calendar/mini_calendar.dart test/ui/mini_calendar_test.dart
git commit -m "feat(ui): add MiniCalendar with busy-level indicator + tests"
```

---

## Task 7: Виды «День», «Неделя» (горизонтальный/вертикальный), «Месяц»

**Files:**
- Create: `lib/ui/planner/day_view.dart`
- Create: `lib/ui/planner/week_view.dart`
- Create: `lib/ui/planner/week_view_vertical.dart`
- Create: `lib/ui/calendar/month_grid.dart`
- Create: `lib/ui/planner/month_view.dart`

- [ ] **Step 1: DayView**

Создать `lib/ui/planner/day_view.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «День»: крупный заголовок дня + все задачи списком.
class DayView extends StatelessWidget {
  const DayView({
    required this.day,
    required this.tasks,
    this.onToggle,
    this.onAdd,
    this.onTaskTap,
    super.key,
  });

  final DateTime day;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final VoidCallback? onAdd;
  final void Function(Task task)? onTaskTap;

  @override
  Widget build(BuildContext context) {
    final title = DateFormat.yMMMd('ru').format(day);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
        ),
        Expanded(
          child: tasks.isEmpty
              ? const Center(child: Text('Нет задач'))
              : ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final t in tasks)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: TaskCard(
                          task: t,
                          onToggle: onToggle == null ? null : () => onToggle!(t),
                          onTap: onTaskTap == null ? null : () => onTaskTap!(t),
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 2: WeekView (горизонтальный)**

Создать `lib/ui/planner/week_view.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/day_column.dart';
import 'package:flutter/material.dart';

/// Вид «Неделя» (горизонтальный): 7 колонок tweek-стиля.
class WeekView extends StatelessWidget {
  const WeekView({
    required this.focalDay,
    required this.tasks,
    this.onToggle,
    this.onAddForDay,
    this.onTaskTap,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final void Function(DateTime day)? onAddForDay;
  final void Function(Task task)? onTaskTap;

  @override
  Widget build(BuildContext context) {
    final days = weekDays(focalDay);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final d in days)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: DayColumn(
                day: d,
                tasks: tasksForDay(d),
                onToggle: onToggle,
                onAdd: onAddForDay == null ? null : () => onAddForDay!(d),
                onTaskTap: onTaskTap,
              ),
            ),
          ),
      ],
    );
  }

  List<Task> tasksForDay(DateTime d) =>
      tasks.where((t) => isSameDay(t.date, d)).toList();
}
```

- [ ] **Step 3: WeekViewVertical**

Создать `lib/ui/planner/week_view_vertical.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «Неделя» (вертикальный): дни сверху вниз, задачи свёрнуты.
/// Для узких экранов (телефон в портрете).
class WeekViewVertical extends StatelessWidget {
  const WeekViewVertical({
    required this.focalDay,
    required this.tasks,
    this.onToggle,
    this.onTaskTap,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final void Function(Task task)? onTaskTap;

  @override
  Widget build(BuildContext context) {
    final days = weekDays(focalDay);
    return ListView(
      padding: const EdgeInsets.all(8),
      children: [
        for (final d in days) ...[
          _dayHeader(d),
          ...tasksForDay(d).map(
            (t) => Padding(
              padding: const EdgeInsets.only(left: 12, bottom: 4),
              child: TaskCard(
                task: t,
                onToggle: onToggle == null ? null : () => onToggle!(t),
                onTap: onTaskTap == null ? null : () => onTaskTap!(t),
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _dayHeader(DateTime d) {
    final today = isSameDay(d, DateTime.now());
    final weekday = DateFormat.E('ru').format(d);
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Text(
        '$weekday ${d.day}',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: today ? AppColors.accent : AppColors.muted,
        ),
      ),
    );
  }

  List<Task> tasksForDay(DateTime d) =>
      tasks.where((t) => isSameDay(t.date, d)).toList();
}
```

- [ ] **Step 4: MonthGrid (большая сетка месяца для вида «Месяц»)**

Создать `lib/ui/calendar/month_grid.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Большая сетка месяца с превью первых задач в каждой ячейке.
class MonthGrid extends StatelessWidget {
  const MonthGrid({
    required this.month,
    required this.tasks,
    required this.selectedDay,
    this.onDaySelected,
    super.key,
  });

  final DateTime month;
  final List<Task> tasks;
  final DateTime selectedDay;
  final ValueChanged<DateTime>? onDaySelected;

  DateTime get _firstOfMonth => DateTime(month.year, month.month, 1);

  @override
  Widget build(BuildContext context) {
    final firstDisplay = _firstOfMonth.subtract(
      Duration(days: (_firstOfMonth.weekday - 1) % 7),
    );
    return Column(
      children: [
        Row(
          children: [
            for (final w in const ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
              Expanded(
                child: Center(
                  child: Text(
                    w,
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.muted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Expanded(
          child: GridView.count(
            crossAxisCount: 7,
            mainAxisSpacing: 3,
            crossAxisSpacing: 3,
            childAspectRatio: 0.75,
            children: [
              for (int i = 0; i < 42; i++)
                _cell(firstDisplay.add(Duration(days: i))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _cell(DateTime day) {
    final inMonth = day.month == _firstOfMonth.month;
    final today = isSameDay(day, DateTime.now());
    final dayTasks = tasks.where((t) => isSameDay(t.date, day)).toList();
    return GestureDetector(
      onTap: () => onDaySelected?.call(DateTime(day.year, day.month, day.day)),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: AppColors.card,
          border: Border.all(
            color: today ? AppColors.accent : AppColors.cardBorder,
            width: today ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${day.day}',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: inMonth ? AppColors.text : AppColors.muted,
              ),
            ),
            for (final t in dayTasks.take(2))
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  t.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 8,
                    color: t.isDone ? AppColors.muted : AppColors.text,
                    decoration:
                        t.isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            if (dayTasks.length > 2)
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Text(
                  '+${dayTasks.length - 2}',
                  style: const TextStyle(fontSize: 7, color: AppColors.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: MonthView (обёртка с навигацией месяца)**

Создать `lib/ui/planner/month_view.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/calendar/month_grid.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «Месяц»: заголовок месяца + навигация + сетка.
class MonthView extends StatelessWidget {
  const MonthView({
    required this.focalDay,
    required this.tasks,
    this.onDaySelected,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final ValueChanged<DateTime>? onDaySelected;

  @override
  Widget build(BuildContext context) {
    final title = DateFormat.yMMMM('ru').format(DateTime(focalDay.year, focalDay.month, 1));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Text(
                '${title[0].toUpperCase()}${title.substring(1)}',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.text,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: MonthGrid(
            month: focalDay,
            tasks: tasks,
            selectedDay: focalDay,
            onDaySelected: onDaySelected,
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 6: Проверить анализом**

Run: `flutter analyze lib/ui/`
Expected: `No issues found!`

- [ ] **Step 7: Закоммитить**

```bash
git add lib/ui/
git commit -m "feat(ui): add Day/Week(horizontal+vertical)/Month views"
```

---

## Task 8: Главный экран (planner_screen) — сборка всего вместе

**Files:**
- Create: `lib/ui/planner/planner_screen.dart`
- Modify: `lib/main.dart`

- [ ] **Step 1: Реализовать PlannerScreen**

Создать `lib/ui/planner/planner_screen.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/data/providers.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/calendar/mini_calendar.dart';
import 'package:daily_planner/ui/planner/day_view.dart';
import 'package:daily_planner/ui/planner/month_view.dart';
import 'package:daily_planner/ui/planner/week_view.dart';
import 'package:daily_planner/ui/planner/week_view_vertical.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:daily_planner/ui/task/task_editor_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

class PlannerScreen extends ConsumerWidget {
  const PlannerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(selectedDateProvider);
    final view = ref.watch(calendarViewProvider);
    final repo = ref.watch(taskRepositoryProvider).valueOrNull;

    final range = _rangeFor(selected, view);
    final tasksAsync = ref.watch(tasksInRangeProvider(range));
    final tasks = tasksAsync.valueOrNull ?? const <Task>[];

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final isWide = constraints.maxWidth >= 720;
            final weekVertical = !isWide;
            return Column(
              children: [
                _TopBar(
                  selected: selected,
                  view: view,
                  onViewChanged: (v) =>
                      ref.read(calendarViewProvider.notifier).state = v,
                  onPrev: () => ref.read(selectedDateProvider.notifier).state =
                      _shift(selected, view, -1),
                  onNext: () => ref.read(selectedDateProvider.notifier).state =
                      _shift(selected, view, 1),
                ),
                Expanded(
                  child: isWide
                      ? Row(
                          children: [
                            SizedBox(
                              width: 220,
                              child: Padding(
                                padding: const EdgeInsets.all(8),
                                child: MiniCalendar(
                                  month: selected,
                                  busyByDay: _busyMap(tasks, selected, view),
                                  selectedDay: selected,
                                  onDaySelected: (d) => ref
                                      .read(selectedDateProvider.notifier)
                                      .state = d,
                                ),
                              ),
                            ),
                            Expanded(child: _body(view, selected, tasks, weekVertical, repo, ref)),
                          ],
                        )
                      : _body(view, selected, tasks, weekVertical, repo, ref),
                ),
              ],
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: repo == null
            ? null
            : () => _addTask(context, ref, repo, selected),
        backgroundColor: AppColors.accent,
        foregroundColor: Colors.white,
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _body(
    CalendarView view,
    DateTime selected,
    List<Task> tasks,
    bool weekVertical,
    TaskRepository? repo,
    WidgetRef ref,
  ) {
    switch (view) {
      case CalendarView.day:
        return DayView(
          day: selected,
          tasks: tasks.where((t) => isSameDay(t.date, selected)).toList(),
          onToggle: repo == null ? null : (t) => _toggle(ref, repo, t),
          onTaskTap: repo == null ? null : (t) => _editTask(ref, repo, t),
        );
      case CalendarView.week:
        return weekVertical
            ? WeekViewVertical(
                focalDay: selected,
                tasks: tasks,
                onToggle: repo == null ? null : (t) => _toggle(ref, repo, t),
                onTaskTap: repo == null ? null : (t) => _editTask(ref, repo, t),
              )
            : WeekView(
                focalDay: selected,
                tasks: tasks,
                onToggle: repo == null ? null : (t) => _toggle(ref, repo, t),
                onAddForDay: repo == null
                    ? null
                    : (day) => _addTask(ref.context, ref, repo, day),
                onTaskTap: repo == null ? null : (t) => _editTask(ref, repo, t),
              );
      case CalendarView.month:
        return MonthView(
          focalDay: selected,
          tasks: tasks,
          onDaySelected: (d) =>
              ref.read(selectedDateProvider.notifier).state = d,
        );
    }
  }

  (DateTime, DateTime) _rangeFor(DateTime selected, CalendarView view) {
    switch (view) {
      case CalendarView.day:
        return (atMidnight(selected), atMidnight(selected));
      case CalendarView.week:
        final days = weekDays(selected);
        return (days.first, days.last);
      case CalendarView.month:
        return (
          DateTime(selected.year, selected.month, 1),
          DateTime(selected.year, selected.month + 1, 0),
        );
    }
  }

  Map<DateTime, int> _busyMap(
      List<Task> tasks, DateTime selected, CalendarView view) {
    final first = DateTime(selected.year, selected.month, 1);
    final last = DateTime(selected.year, selected.month + 1, 0);
    final map = <DateTime, int>{};
    for (final t in tasks) {
      if (t.date.isBefore(first) || t.date.isAfter(last)) continue;
      final key = DateTime(t.date.year, t.date.month, t.date.day);
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }

  DateTime _shift(DateTime d, CalendarView view, int dir) {
    switch (view) {
      case CalendarView.day:
        return d.add(Duration(days: dir));
      case CalendarView.week:
        return d.add(Duration(days: 7 * dir));
      case CalendarView.month:
        return DateTime(d.year, d.month + dir, d.day);
    }
  }

  Future<void> _addTask(
    BuildContext context,
    WidgetRef ref,
    TaskRepository repo,
    DateTime day,
  ) async {
    final result = await showModalBottomSheet<(String, String?)>(
      context: context,
      builder: (_) => const TaskEditorSheet(),
    );
    if (result == null) return;
    final (title, colorSetId) = result;
    final now = DateTime.now();
    await repo.upsertTask(Task(
      id: const Uuid().v4(),
      title: title,
      date: atMidnight(day),
      isDone: false,
      colorSetId: colorSetId,
      sortOrder: now.millisecondsSinceEpoch.toDouble(),
      createdAt: now,
      updatedAt: now,
      deviceId: '',
    ));
  }

  Future<void> _editTask(WidgetRef ref, TaskRepository repo, Task task) async {
    final result = await showModalBottomSheet<(String, String?)>(
      context: ref.context,
      builder: (_) => TaskEditorSheet(
        initialTitle: task.title,
        initialColorSetId: task.colorSetId,
      ),
    );
    if (result == null) return;
    final (title, colorSetId) = result;
    await repo.upsertTask(task.copyWith(title: title, colorSetId: colorSetId));
  }

  Future<void> _toggle(WidgetRef ref, TaskRepository repo, Task task) async {
    await repo.upsertTask(task.copyWith(isDone: !task.isDone));
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.selected,
    required this.view,
    required this.onViewChanged,
    required this.onPrev,
    required this.onNext,
  });

  final DateTime selected;
  final CalendarView view;
  final ValueChanged<CalendarView> onViewChanged;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  String get _label {
    switch (view) {
      case CalendarView.day:
        return DateFormat.yMMMd('ru').format(selected);
      case CalendarView.week:
        final days = weekDays(selected);
        return '${DateFormat.d('ru').format(days.first)}–'
            '${DateFormat.d('ru').format(days.last)} '
            '${DateFormat.MMMM('ru').format(days.last)}';
      case CalendarView.month:
        return DateFormat.yMMMM('ru').format(DateTime(selected.year, selected.month, 1));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          IconButton(onPressed: onPrev, icon: const Icon(Icons.chevron_left)),
          Expanded(
            child: Center(
              child: Text(
                _label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.text,
                ),
              ),
            ),
          ),
          IconButton(onPressed: onNext, icon: const Icon(Icons.chevron_right)),
          const SizedBox(width: 8),
          SegmentedButton<CalendarView>(
            segments: const [
              ButtonSegment(value: CalendarView.day, label: Text('День', style: TextStyle(fontSize: 11))),
              ButtonSegment(value: CalendarView.week, label: Text('Неделя', style: TextStyle(fontSize: 11))),
              ButtonSegment(value: CalendarView.month, label: Text('Месяц', style: TextStyle(fontSize: 11))),
            ],
            selected: {view},
            onSelectionChanged: (s) => onViewChanged(s.first),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Подключить PlannerScreen в main.dart**

Заменить `home:` в `main.dart`:
```dart
home: const PlannerScreen(),
```
Добавить импорт:
```dart
import 'package:daily_planner/ui/planner/planner_screen.dart';
```

- [ ] **Step 3: Проверить анализом**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 4: Закоммитить**

```bash
git add lib/ui/planner/planner_screen.dart lib/main.dart
git commit -m "feat(ui): assemble PlannerScreen with view switcher and mini calendar"
```

---

## Task 9: Финальная проверка

- [ ] **Step 1: Прогнать весь набор тестов**

Run: `flutter test`
Expected: `All tests passed!` (все из Части 1 + новые widget-тесты)

- [ ] **Step 2: Прогнать анализатор**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 3: Собрать debug-APK**

Run: `flutter build apk --debug`
Expected: `Built build/app/outputs/flutter-apk/app-debug.apk`
