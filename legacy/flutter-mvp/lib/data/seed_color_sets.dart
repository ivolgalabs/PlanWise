import 'database/database.dart';

/// Дефолтные наборы цветов (создаются при первом запуске).
/// Цвета — ARGB. Акцент проекта: терракотовый #C9A87C.
const _defaults = <_DefaultSet>[
  _DefaultSet('cs-none', 'Без категории', 0xFFF0ECE2, 0.0),
  _DefaultSet('cs-work', 'Работа', 0xFFC9A87C, 1.0),
  _DefaultSet('cs-personal', 'Личное', 0xFF7EB8C4, 2.0),
  _DefaultSet('cs-sport', 'Спорт', 0xFFE8A87C, 3.0),
];

class _DefaultSet {
  const _DefaultSet(this.id, this.name, this.color, this.sortOrder);
  final String id;
  final String name;
  final int color;
  final double sortOrder;
}

/// Вставляет дефолтные сеты, если таблица пуста. Идемпотентно.
Future<void> seedDefaultColorSets(AppDatabase db) async {
  final existing = await db.allColorSets();
  if (existing.isNotEmpty) return;
  for (final d in _defaults) {
    await db.upsertColorSet(
      ColorSetsCompanion.insert(
        id: d.id,
        name: d.name,
        color: d.color,
        sortOrder: d.sortOrder,
      ),
    );
  }
}
