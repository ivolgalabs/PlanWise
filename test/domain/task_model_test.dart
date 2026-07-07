import 'package:daily_planner/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Task', () {
    test('creates with required fields', () {
      final task = Task(
        id: 'task-1',
        title: 'Купить хлеб',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0.0,
        createdAt: DateTime(2026, 7, 7, 9),
        updatedAt: DateTime(2026, 7, 7, 9),
        deviceId: 'device-1',
      );
      expect(task.title, 'Купить хлеб');
      expect(task.isDone, isFalse);
      expect(task.colorSetId, isNull);
    });

    test('copyWith updates only given fields', () {
      final task = Task(
        id: 'task-1',
        title: 'A',
        date: DateTime(2026, 7, 7),
        isDone: false,
        colorSetId: null,
        sortOrder: 0.0,
        createdAt: DateTime(2026, 7, 7, 9),
        updatedAt: DateTime(2026, 7, 7, 9),
        deviceId: 'device-1',
      );
      final done = task.copyWith(isDone: true, title: 'A (done)');
      expect(done.isDone, isTrue);
      expect(done.title, 'A (done)');
      expect(done.id, 'task-1');
    });
  });

  group('ColorSet', () {
    test('creates with name and color', () {
      final set = ColorSet(
        id: 's1',
        name: 'Работа',
        color: 0xFFC9A87C,
        sortOrder: 1.0,
      );
      expect(set.name, 'Работа');
      expect(set.color, 0xFFC9A87C);
    });
  });
}
