import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/calendar/month_grid.dart';
import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Вид «Месяц»: заголовок месяца + навигация + сетка.
class MonthView extends StatelessWidget {
  const MonthView({
    required this.focalDay,
    required this.tasks,
    this.onDaySelected,
    super.key,
  });

  final DateTime focalDay;
  final List<Task> tasks;
  final ValueChanged<DateTime>? onDaySelected;

  @override
  Widget build(BuildContext context) {
    final title = DateFormat.yMMMM('ru').format(
      DateTime(focalDay.year, focalDay.month, 1),
    );
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Text(
                  '${title[0].toUpperCase()}${title.substring(1)}',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text,
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: MonthGrid(
              month: focalDay,
              tasks: tasks,
              selectedDay: focalDay,
              onDaySelected: onDaySelected,
            ),
          ),
        ],
      ),
    );
  }
}
