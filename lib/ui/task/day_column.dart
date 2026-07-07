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
