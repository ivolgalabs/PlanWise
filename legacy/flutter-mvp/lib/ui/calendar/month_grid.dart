import 'package:daily_planner/core/date_utils.dart';
import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Большая сетка месяца с превью первых задач в каждой ячейке.
class MonthGrid extends StatelessWidget {
  const MonthGrid({
    required this.month,
    required this.tasks,
    required this.selectedDay,
    this.onDaySelected,
    super.key,
  });

  final DateTime month;
  final List<Task> tasks;
  final DateTime selectedDay;
  final ValueChanged<DateTime>? onDaySelected;

  DateTime get _firstOfMonth => DateTime(month.year, month.month, 1);

  @override
  Widget build(BuildContext context) {
    final firstDisplay = _firstOfMonth.subtract(
      Duration(days: (_firstOfMonth.weekday - 1) % 7),
    );
    return Column(
      children: [
        Row(
          children: [
            for (final w in const ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
              Expanded(
                child: Center(
                  child: Text(
                    w,
                    style: const TextStyle(
                      fontSize: 10,
                      color: AppColors.muted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        Expanded(
          child: GridView.count(
            crossAxisCount: 7,
            mainAxisSpacing: 3,
            crossAxisSpacing: 3,
            childAspectRatio: 0.75,
            children: [
              for (int i = 0; i < 42; i++)
                _cell(firstDisplay.add(Duration(days: i))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _cell(DateTime day) {
    final inMonth = day.month == _firstOfMonth.month;
    final today = isSameDay(day, DateTime.now());
    final dayTasks = tasks.where((t) => isSameDay(t.date, day)).toList();
    return GestureDetector(
      onTap: () =>
          onDaySelected?.call(DateTime(day.year, day.month, day.day)),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: AppColors.card,
          border: Border.all(
            color: today ? AppColors.accent : AppColors.cardBorder,
            width: today ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${day.day}',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: inMonth ? AppColors.text : AppColors.muted,
              ),
            ),
            for (final t in dayTasks.take(2))
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  t.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 8,
                    color: t.isDone ? AppColors.muted : AppColors.text,
                    decoration: t.isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            if (dayTasks.length > 2)
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Text(
                  '+${dayTasks.length - 2}',
                  style: const TextStyle(fontSize: 7, color: AppColors.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
