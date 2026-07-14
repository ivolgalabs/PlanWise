import 'package:daily_planner/core/date_utils.dart' as du;
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('startOfWeek', () {
    test('Monday is the first day of ISO week', () {
      // Среда 8 июля 2026
      final wed = DateTime(2026, 7, 8);
      expect(
        du.startOfWeek(wed, startWithMonday: true),
        DateTime(2026, 7, 6),
      ); // Пн 6 июля
    });

    test('Sunday belongs to previous week when week starts Monday', () {
      final sun = DateTime(2026, 7, 5);
      expect(du.startOfWeek(sun, startWithMonday: true), DateTime(2026, 6, 29));
    });
  });

  group('weekDays', () {
    test('returns 7 consecutive days from start', () {
      final days = du.weekDays(DateTime(2026, 7, 8));
      expect(days.length, 7);
      expect(days.first, DateTime(2026, 7, 6));
      expect(days.last, DateTime(2026, 7, 12));
    });
  });

  group('isSameDay', () {
    test('ignores time component', () {
      expect(
        du.isSameDay(DateTime(2026, 7, 7, 9), DateTime(2026, 7, 7, 23)),
        isTrue,
      );
      expect(du.isSameDay(DateTime(2026, 7, 7), DateTime(2026, 7, 8)), isFalse);
    });
  });
}
