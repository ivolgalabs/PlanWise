# Фаза 1, Часть 3: Drag-and-drop задач между днями

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Позволить пользователю перетаскивать карточку задачи из одного дня в другой в виде «Неделя» (горизонтальный и вертикальный), обновляя дату задачи через репозиторий.

**Architecture:** Flutter-виджет `DragTarget` на колонке дня + `LongPressDraggable` обёртка вокруг `TaskCard`. При drop вызывается `repo.moveTask(taskId, newDate)`. Стрим БД реактивно обновляет UI — ручная перестановка состояния не нужна.

**Tech Stack:** Flutter (`DragTarget`, `LongPressDraggable`), riverpod, существующий `TaskRepository.moveTask`.

**Зависит от:** Часть 2 (WeekView, DayColumn, TaskCard, провайдеры) — готова.

---

## Файловая структура

```
lib/ui/task/
├── draggable_task_card.dart   # Create: обёртка LongPressDraggable<Task> вокруг TaskCard
└── day_column.dart            # Modify: обернуть ListView в DragTarget<Task>
lib/ui/planner/
├── week_view.dart             # Modify: использовать DraggableTaskCard
└── week_view_vertical.dart    # Modify: использовать DraggableTaskCard + DragTarget на заголовке дня
test/ui/
└── draggable_task_card_test.dart  # Create: виджет-тест drop-логики
```

---

## Task 1: DraggableTaskCard — обёртка с перетаскиванием

**Files:**
- Create: `lib/ui/task/draggable_task_card.dart`
- Test: `test/ui/draggable_task_card_test.dart`

- [ ] **Step 1: Написать widget-тест на перетаскивание**

Создать `test/ui/draggable_task_card_test.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Task task() => Task(
        id: 't1',
        title: 'A',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0,
        createdAt: DateTime(2026, 7, 7),
        updatedAt: DateTime(2026, 7, 7),
        deviceId: 'd1',
      );

  testWidgets('long-press starts drag and shows feedback', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: DraggableTaskCard(task: task()),
      ),
    ));
    expect(find.text('A'), findsOneWidget);
    // long press to start drag
    await tester.timedDrag(
      find.text('A'),
      const Offset(50, 0),
      const Duration(seconds: 1),
    );
    await tester.pumpAndSettle();
    // Feedback-копия карточки появляется во время drag
    expect(find.byType(DraggableTaskCard), findsWidgets);
  });
}
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `flutter test test/ui/draggable_task_card_test.dart`
Expected: FAIL — `DraggableTaskCard` не существует.

- [ ] **Step 3: Реализовать DraggableTaskCard**

Создать `lib/ui/task/draggable_task_card.dart`:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:flutter/material.dart';

/// TaskCard, который можно перетащить (long-press) в другую колонку дня.
/// data = передаём доменный Task, чтобы DragTarget knew, что двигать.
class DraggableTaskCard extends StatelessWidget {
  const DraggableTaskCard({
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
    return LongPressDraggable<Task>(
      data: task,
      delay: const Duration(milliseconds: 250),
      feedback: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(6),
        child: SizedBox(
          width: MediaQuery.of(context).size.width * 0.4,
          child: TaskCard(task: task),
        ),
      ),
      childWhenDragging: Opacity(
        opacity: 0.3,
        child: TaskCard(task: task),
      ),
      child: TaskCard(
        task: task,
        onToggle: onToggle,
        onTap: onTap,
      ),
    );
  }
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `flutter test test/ui/draggable_task_card_test.dart`
Expected: `All tests passed!`

- [ ] **Step 5: Закоммитить**

```bash
git add lib/ui/task/draggable_task_card.dart test/ui/draggable_task_card_test.dart
git commit -m "feat(ui): add DraggableTaskCard with long-press drag feedback"
```

---

## Task 2: DayColumn принимает drop задачи

**Files:**
- Modify: `lib/ui/task/day_column.dart`

- [ ] **Step 1: Обернуть содержимое DayColumn в DragTarget<Task>**

В `lib/ui/task/day_column.dart` добавить импорт вверху:
```dart
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
```
(импорт models.dart уже может быть через task_card; добавьте явно, если анализатор ругается)

Заменить тело `build` так, чтобы весь Container был обёрнут в `DragTarget<Task>`, и заменить `TaskCard` на `DraggableTaskCard` в ListView.

Полная новая версия `day_column.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Колонка одного дня: заголовок + список карточек задач.
/// Принимает перетаскиваемую задачу (DragTarget<Task>), вызывая [onMoveToDay].
class DayColumn extends StatelessWidget {
  const DayColumn({
    required this.day,
    required this.tasks,
    this.onToggle,
    this.onAdd,
    this.onTaskTap,
    this.onMoveToDay,
    super.key,
  });

  final DateTime day;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final VoidCallback? onAdd;
  final void Function(Task task)? onTaskTap;
  final void Function(Task task)? onMoveToDay;

  bool get _isToday => isSameDay(day, DateTime.now());

  @override
  Widget build(BuildContext context) {
    return DragTarget<Task>(
      onAcceptWithDetails: (details) {
        final t = details.data;
        // Если задача уже в этом дне — игнорируем.
        if (!isSameDay(t.date, day)) {
          onMoveToDay?.call(t);
        }
      },
      builder: (context, candidate, rejected) {
        final isHovering = candidate.isNotEmpty;
        return Container(
          decoration: BoxDecoration(
            color: isHovering
                ? AppColors.accent.withValues(alpha: 0.08)
                : AppColors.card,
            border: Border.all(
              color: isHovering
                  ? AppColors.accent
                  : (_isToday ? AppColors.accent : AppColors.cardBorder),
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
                      DateFormat.E('ru').format(day),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color:
                            _isToday ? AppColors.accent : AppColors.muted,
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
                      DateFormat('d').format(day),
                      style: TextStyle(
                        fontSize: 10,
                        color:
                            _isToday ? AppColors.accent : AppColors.muted,
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
                        child: DraggableTaskCard(
                          task: t,
                          onToggle:
                              onToggle == null ? null : () => onToggle!(t),
                          onTap:
                              onTaskTap == null ? null : () => onTaskTap!(t),
                        ),
                      ),
                  ],
                ),
              ),
              if (onAdd != null)
                IconButton(
                  icon: const Icon(Icons.add,
                      size: 18, color: AppColors.muted),
                  onPressed: onAdd,
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
        );
      },
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
git commit -m "feat(ui): DayColumn accepts dropped tasks via DragTarget"
```

---

## Task 3: WeekView (горизонтальный) использует moveTask

**Files:**
- Modify: `lib/ui/planner/week_view.dart`

- [ ] **Step 1: Добавить onMoveToDay в DayColumn внутри WeekView**

Заменить содержимое `lib/ui/planner/week_view.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/day_column.dart';
import 'package:flutter/material.dart';

/// Вид «Неделя» (горизонтальный): 7 колонок tweek-стиля с drop-переносом.
class WeekView extends StatelessWidget {
  const WeekView({
    required this.focalDay,
    required this.tasks,
    this.onToggle,
    this.onAddForDay,
    this.onTaskTap,
    this.onMoveTask,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final void Function(DateTime day)? onAddForDay;
  final void Function(Task task)? onTaskTap;
  final void Function(Task task, DateTime newDay)? onMoveTask;

  @override
  Widget build(BuildContext context) {
    final days = weekDays(focalDay);
    return Padding(
      padding: const EdgeInsets.all(4),
      child: Row(
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
                  onMoveToDay: onMoveTask == null
                      ? null
                      : (task) => onMoveTask!(task, d),
                ),
              ),
            ),
        ],
      ),
    );
  }

  List<Task> tasksForDay(DateTime d) =>
      tasks.where((t) => isSameDay(t.date, d)).toList();
}
```

- [ ] **Step 2: Проверить анализом**

Run: `flutter analyze lib/ui/planner/week_view.dart`
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/ui/planner/week_view.dart
git commit -m "feat(ui): WeekView passes onMoveTask to DayColumn drop targets"
```

---

## Task 4: WeekViewVertical с drop на дне

**Files:**
- Modify: `lib/ui/planner/week_view_vertical.dart`

- [ ] **Step 1: Обернуть каждый блок дня в DragTarget**

Заменить содержимое `lib/ui/planner/week_view_vertical.dart`:
```dart
import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «Неделя» (вертикальный): дни сверху вниз, с drop-переносом на день.
class WeekViewVertical extends StatelessWidget {
  const WeekViewVertical({
    required this.focalDay,
    required this.tasks,
    this.onToggle,
    this.onTaskTap,
    this.onMoveTask,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final void Function(Task task)? onToggle;
  final void Function(Task task)? onTaskTap;
  final void Function(Task task, DateTime newDay)? onMoveTask;

  @override
  Widget build(BuildContext context) {
    final days = weekDays(focalDay);
    return ListView(
      padding: const EdgeInsets.all(8),
      children: [
        for (final d in days)
          DragTarget<Task>(
            onAcceptWithDetails: (details) {
              if (!isSameDay(details.data.date, d)) {
                onMoveTask?.call(details.data, d);
              }
            },
            builder: (context, candidate, rejected) {
              final hovering = candidate.isNotEmpty;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _dayHeader(d, hovering),
                  ...tasksForDay(d).map(
                    (t) => Padding(
                      padding: const EdgeInsets.only(left: 12, bottom: 4),
                      child: DraggableTaskCard(
                        task: t,
                        onToggle: onToggle == null ? null : () => onToggle!(t),
                        onTap: onTaskTap == null ? null : () => onTaskTap!(t),
                      ),
                    ),
                  ),
                  if (hovering)
                    const Padding(
                      padding: EdgeInsets.only(left: 12, top: 4),
                      child: DottedDropHint(),
                    ),
                  const SizedBox(height: 8),
                ],
              );
            },
          ),
      ],
    );
  }

  Widget _dayHeader(DateTime d, bool hovering) {
    final today = isSameDay(d, DateTime.now());
    final weekday = DateFormat.E('ru').format(d);
    return Container(
      decoration: BoxDecoration(
        color: hovering ? AppColors.accent.withValues(alpha: 0.08) : null,
        borderRadius: BorderRadius.circular(6),
      ),
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
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

/// Пунктирная подсказка зоны drop.
class DottedDropHint extends StatelessWidget {
  const DottedDropHint({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24,
      decoration: BoxDecoration(
        border: Border.all(
          color: AppColors.accent.withValues(alpha: 0.5),
          width: 1,
        ),
        borderRadius: BorderRadius.circular(6),
      ),
      alignment: Alignment.center,
      child: Text(
        'Перетащите сюда',
        style: TextStyle(
          fontSize: 9,
          color: AppColors.accent.withValues(alpha: 0.7),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: Проверить анализом**

Run: `flutter analyze lib/ui/planner/week_view_vertical.dart`
Expected: `No issues found!`

- [ ] **Step 3: Закоммитить**

```bash
git add lib/ui/planner/week_view_vertical.dart
git commit -m "feat(ui): WeekViewVertical accepts dropped tasks with hint"
```

---

## Task 5: PlannerScreen связывает drop с moveTask

**Files:**
- Modify: `lib/ui/planner/planner_screen.dart`

- [ ] **Step 1: Добавить onMoveTask в вызовы WeekView/WeekViewVertical**

В `lib/ui/planner/planner_screen.dart`, в методе `_body`:

В ветке `CalendarView.week` (weekVertical == false) добавить параметр:
```dart
onMoveTask: repo == null ? null : (task, newDay) => _moveTask(ref, repo, task, newDay),
```

В ветке `CalendarView.week` (weekVertical == true) добавить тот же параметр.

- [ ] **Step 2: Добавить метод _moveTask в класс PlannerScreen**

```dart
  Future<void> _moveTask(
    WidgetRef ref,
    TaskRepository repo,
    Task task,
    DateTime newDay,
  ) async {
    await repo.moveTask(task.id, atMidnight(newDay));
  }
```

- [ ] **Step 3: Проверить анализом**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 4: Закоммитить**

```bash
git add lib/ui/planner/planner_screen.dart
git commit -m "feat(ui): wire drop-to-move into PlannerScreen via moveTask"
```

---

## Task 6: Финальная проверка + smoke на эмуляторе

- [ ] **Step 1: Полный набор тестов**

Run: `flutter test`
Expected: `All tests passed!` (22 + новый drag-тест)

- [ ] **Step 2: Анализатор**

Run: `flutter analyze`
Expected: `No issues found!`

- [ ] **Step 3: Сборка APK**

Run: `flutter build apk --debug`
Expected: `Built build/app/outputs/flutter-apk/app-debug.apk`

- [ ] **Step 4: Smoke на эмуляторе**

Запустить эмулятор, инсталлировать APK, создать задачу, long-press перетащить в соседний день — задача должна переместиться (исчезнуть из старого дня, появиться в новом).
