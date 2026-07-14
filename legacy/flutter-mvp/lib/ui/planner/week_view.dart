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
