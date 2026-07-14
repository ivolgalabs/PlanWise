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
