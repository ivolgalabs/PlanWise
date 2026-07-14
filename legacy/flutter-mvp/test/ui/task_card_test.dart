import 'package:daily_planner/domain/models.dart';
import 'package:daily_planner/ui/task/task_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Task task({bool done = false, String? setId, String title = 'Купить хлеб'}) =>
      Task(
        id: 't1',
        title: title,
        date: DateTime(2026, 7, 7),
        isDone: done,
        colorSetId: setId,
        sortOrder: 0,
        createdAt: DateTime(2026, 7, 7),
        updatedAt: DateTime(2026, 7, 7),
        deviceId: 'd1',
      );

  testWidgets('shows title', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: TaskCard(task: task())),
    ));
    expect(find.text('Купить хлеб'), findsOneWidget);
  });

  testWidgets('tapping checkbox calls onToggle', (tester) async {
    bool? toggled;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: TaskCard(task: task(), onToggle: () => toggled = true),
      ),
    ));
    await tester.tap(find.byType(Checkbox));
    expect(toggled, isTrue);
  });

  testWidgets('done task is struck through', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: TaskCard(task: task(done: true))),
    ));
    final text = tester.widget<Text>(find.text('Купить хлеб'));
    expect(text.style?.decoration, TextDecoration.lineThrough);
  });
}
