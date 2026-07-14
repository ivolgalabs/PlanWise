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
