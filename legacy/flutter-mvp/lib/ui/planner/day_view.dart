import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «День»: крупный заголовок дня + все задачи списком.
class DayView extends StatelessWidget {
  const DayView({
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

  @override
  Widget build(BuildContext context) {
    final title = DateFormat.yMMMd('ru').format(day);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
        ),
        Expanded(
          child: tasks.isEmpty
              ? const Center(child: Text('Нет задач'))
              : ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final t in tasks)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: TaskCard(
                          task: t,
                          onToggle: onToggle == null ? null : () => onToggle!(t),
                          onTap: onTaskTap == null ? null : () => onTaskTap!(t),
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
