import 'package:daily_planner/ui/calendar/mini_calendar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('ru', null);
  });
  group('busyLevel', () {
    test('0 tasks => free', () {
      expect(busyLevel(0), BusyLevel.free);
    });
    test('1-2 tasks => light', () {
      expect(busyLevel(1), BusyLevel.light);
      expect(busyLevel(2), BusyLevel.light);
    });
    test('3+ tasks => heavy', () {
      expect(busyLevel(3), BusyLevel.heavy);
      expect(busyLevel(10), BusyLevel.heavy);
    });
  });

  testWidgets('mini calendar renders month title', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 220,
            height: 260,
            child: MiniCalendar(
              month: DateTime(2026, 7, 1),
              busyByDay: const {},
              selectedDay: DateTime(2026, 7, 2),
              onDaySelected: (_) {},
            ),
          ),
        ),
      ),
    ));
    expect(find.textContaining('Июль'), findsOneWidget);
  });
}
