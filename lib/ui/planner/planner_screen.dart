import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/data/providers.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/domain/task_repository.dart';
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
    final repo = ref.watch(taskRepositoryProvider).value;

    final range = _rangeFor(selected, view);
    final tasksAsync = ref.watch(tasksInRangeProvider(range));
    final tasks = tasksAsync.value ?? const <Task>[];

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
                      ref.read(calendarViewProvider.notifier).set(v),
                  onPrev: () => ref
                      .read(selectedDateProvider.notifier)
                      .set(_shift(selected, view, -1)),
                  onNext: () => ref
                      .read(selectedDateProvider.notifier)
                      .set(_shift(selected, view, 1)),
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
                                  busyByDay: _busyMap(tasks, selected),
                                  selectedDay: selected,
                                  onDaySelected: (d) => ref
                                      .read(selectedDateProvider.notifier)
                                      .set(d),
                                ),
                              ),
                            ),
                            Expanded(
                              child: _body(
                                view,
                                selected,
                                tasks,
                                weekVertical,
                                repo,
                                ref,
                              ),
                            ),
                          ],
                        )
                      : _body(
                          view,
                          selected,
                          tasks,
                          weekVertical,
                          repo,
                          ref,
                        ),
                ),
              ],
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed:
            repo == null ? null : () => _addTask(context, ref, repo, selected),
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
                onMoveTask: repo == null
                    ? null
                    : (task, newDay) => _moveTask(ref, repo, task, newDay),
              )
            : WeekView(
                focalDay: selected,
                tasks: tasks,
                onToggle: repo == null ? null : (t) => _toggle(ref, repo, t),
                onAddForDay: repo == null
                    ? null
                    : (day) => _addTask(ref.context, ref, repo, day),
                onTaskTap: repo == null ? null : (t) => _editTask(ref, repo, t),
                onMoveTask: repo == null
                    ? null
                    : (task, newDay) => _moveTask(ref, repo, task, newDay),
              );
      case CalendarView.month:
        return MonthView(
          focalDay: selected,
          tasks: tasks,
          onDaySelected: (d) =>
              ref.read(selectedDateProvider.notifier).set(d),
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

  Map<DateTime, int> _busyMap(List<Task> tasks, DateTime selected) {
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
    final result = await showModalBottomSheet<({String title, String? colorSetId})>(
      context: context,
      builder: (_) => const TaskEditorSheet(),
    );
    if (result == null) return;
    final now = DateTime.now();
    await repo.upsertTask(
      Task(
        id: const Uuid().v4(),
        title: result.title,
        date: atMidnight(day),
        isDone: false,
        colorSetId: result.colorSetId,
        sortOrder: now.millisecondsSinceEpoch.toDouble(),
        createdAt: now,
        updatedAt: now,
        deviceId: '',
      ),
    );
  }

  Future<void> _editTask(
    WidgetRef ref,
    TaskRepository repo,
    Task task,
  ) async {
    final result =
        await showModalBottomSheet<({String title, String? colorSetId})>(
      context: ref.context,
      builder: (_) => TaskEditorSheet(
        initialTitle: task.title,
        initialColorSetId: task.colorSetId,
      ),
    );
    if (result == null) return;
    await repo.upsertTask(
      task.copyWith(title: result.title, colorSetId: result.colorSetId),
    );
  }

  Future<void> _toggle(
    WidgetRef ref,
    TaskRepository repo,
    Task task,
  ) async {
    await repo.upsertTask(task.copyWith(isDone: !task.isDone));
  }

  Future<void> _moveTask(
    WidgetRef ref,
    TaskRepository repo,
    Task task,
    DateTime newDay,
  ) async {
    await repo.moveTask(task.id, atMidnight(newDay));
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
        return '${days.first.day}–${days.last.day} '
            '${DateFormat.MMMM('ru').format(days.last)}';
      case CalendarView.month:
        return DateFormat.yMMMM('ru').format(
          DateTime(selected.year, selected.month, 1),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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
          const SizedBox(width: 4),
          SegmentedButton<CalendarView>(
            segments: const [
              ButtonSegment(
                value: CalendarView.day,
                label: Text('День', style: TextStyle(fontSize: 11)),
              ),
              ButtonSegment(
                value: CalendarView.week,
                label: Text('Неделя', style: TextStyle(fontSize: 11)),
              ),
              ButtonSegment(
                value: CalendarView.month,
                label: Text('Месяц', style: TextStyle(fontSize: 11)),
              ),
            ],
            selected: {view},
            onSelectionChanged: (s) => onViewChanged(s.first),
          ),
        ],
      ),
    );
  }
}
