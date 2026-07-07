import 'package:daily_planner/ui/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Уровень занятости дня для индикатора в мини-календаре.
enum BusyLevel { free, light, heavy }

/// Подсчёт уровня занятости по количеству задач.
BusyLevel busyLevel(int count) {
  if (count == 0) return BusyLevel.free;
  if (count <= 2) return BusyLevel.light;
  return BusyLevel.heavy;
}

/// Мини-календарь месяца с индикатором занятости дней.
/// [busyByDay] — карта: дата (полночь) -> число задач.
class MiniCalendar extends StatelessWidget {
  const MiniCalendar({
    required this.month,
    required this.busyByDay,
    required this.selectedDay,
    required this.onDaySelected,
    super.key,
  });

  /// Любой день нужного месяца.
  final DateTime month;
  final Map<DateTime, int> busyByDay;
  final DateTime selectedDay;
  final ValueChanged<DateTime> onDaySelected;

  DateTime get _firstOfMonth => DateTime(month.year, month.month, 1);

  @override
  Widget build(BuildContext context) {
    final firstDisplay = _firstOfMonth.subtract(
      Duration(days: (_firstOfMonth.weekday - 1) % 7),
    );
    final monthTitle = DateFormat.yMMMM('ru').format(_firstOfMonth);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.card,
        border: Border.all(color: AppColors.cardBorder),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${monthTitle[0].toUpperCase()}${monthTitle.substring(1)}',
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.text,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final w in const ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'])
                Expanded(
                  child: Center(
                    child: Text(
                      w,
                      style: const TextStyle(
                        fontSize: 8,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
            childAspectRatio: 1,
            children: [
              for (int i = 0; i < 42; i++)
                _dayCell(firstDisplay.add(Duration(days: i))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _dayCell(DateTime day) {
    final inMonth = day.month == _firstOfMonth.month;
    final key = DateTime(day.year, day.month, day.day);
    final isSelected = key ==
        DateTime(selectedDay.year, selectedDay.month, selectedDay.day);
    final level = busyByDay[key] ?? 0;
    final busy = busyLevel(level);

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onDaySelected(key),
      child: Container(
        decoration: BoxDecoration(
          color: isSelected ? AppColors.accent.withValues(alpha: 0.15) : null,
          borderRadius: BorderRadius.circular(4),
        ),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${day.day}',
              style: TextStyle(
                fontSize: 9,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                color: inMonth
                    ? (isSelected ? AppColors.accent : AppColors.text)
                    : AppColors.muted.withValues(alpha: 0.4),
              ),
            ),
            const SizedBox(height: 1),
            _busyIndicator(busy),
          ],
        ),
      ),
    );
  }

  Widget _busyIndicator(BusyLevel level) {
    switch (level) {
      case BusyLevel.free:
        return const SizedBox(height: 3);
      case BusyLevel.light:
        return Container(
          width: 3,
          height: 3,
          decoration: const BoxDecoration(
            color: AppColors.accent,
            shape: BoxShape.circle,
          ),
        );
      case BusyLevel.heavy:
        return Container(
          width: 10,
          height: 3,
          decoration: BoxDecoration(
            color: AppColors.setSport,
            borderRadius: BorderRadius.circular(2),
          ),
        );
    }
  }
}
