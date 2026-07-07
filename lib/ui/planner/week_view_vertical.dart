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
