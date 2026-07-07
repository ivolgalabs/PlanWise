import 'package:daily_planner/data/database/database.dart';
import 'package:daily_planner/data/seed_color_sets.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('seedDefaultColorSets inserts 4 defaults if empty', () async {
    await seedDefaultColorSets(db);
    final all = await db.allColorSets();
    expect(all.length, 4);
    expect(
      all.map((c) => c.name),
      containsAll(['Без категории', 'Работа', 'Личное', 'Спорт']),
    );
  });

  test('seedDefaultColorSets is idempotent', () async {
    await seedDefaultColorSets(db);
    await seedDefaultColorSets(db);
    final all = await db.allColorSets();
    expect(all.length, 4);
  });
}
