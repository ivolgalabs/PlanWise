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
