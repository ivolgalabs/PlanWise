import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Колонка одного дня: заголовок + список карточек задач.
/// Принимает перетаскиваемую задачу (`DragTarget<Task>`), вызывая [onMoveToDay].
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
                      DateFormat('d').format(day),
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
                  icon:
                      const Icon(Icons.add, size: 18, color: AppColors.muted),
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
