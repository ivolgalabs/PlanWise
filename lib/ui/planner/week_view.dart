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
