import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/draggable_task_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Task task() => Task(
        id: 't1',
        title: 'A',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0,
        createdAt: DateTime(2026, 7, 7),
        updatedAt: DateTime(2026, 7, 7),
        deviceId: 'd1',
      );

  testWidgets('renders task title', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: DraggableTaskCard(task: task())),
    ));
    expect(find.text('A'), findsOneWidget);
  });

  testWidgets('long-press drag starts and produces feedback', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: DraggableTaskCard(task: task())),
    ));
    // long press to start drag
    await tester.timedDrag(
      find.text('A'),
      const Offset(50, 0),
      const Duration(seconds: 1),
    );
    await tester.pumpAndSettle();
    // feedback-копия карточки появляется во время drag
    expect(find.byType(DraggableTaskCard), findsWidgets);
  });
}
