# Сетка недели 2-линейная + перенос текста + «Когда-нибудь» — дизайн

**Дата:** 2026-08-03 · **Итерация 3 UI/данных** · **Статус:** согласован

## 1. Цель

Три связанных улучшения:
1. **Сетка недели — 2 линии:** 7 дней раскладываются в два ряда (Пн–Чт сверху, Пт–Вс снизу) — колонки становятся ~330-440px вместо 140px, текст читается.
2. **Перенос текста в сетке:** строка задачи в компактном режиме — авто-растущий textarea (перенос по словам до 2-3 строк), Enter — сохранить и создать следующую (как сейчас), Shift+Enter — перенос строки.
3. **Колонка «Когда-нибудь»** (аналог Someday в tweek.so): задачи без привязки ко дню, доступна в «Неделе» и «Дне», drag-перенос в обе стороны.

## 2. Хранение «Когда-нибудь» (флаг, без nullable date)

**Миграция `V5__someday.sql`:**
```sql
-- «Когда-нибудь»: задача без привязки ко дню (date игнорируется, = 0).
ALTER TABLE tasks ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
```

**Модель:** `Task.someday: bool` (`#[serde(default)]`). date остаётся NOT NULL (для someday — 0).

**Команды:**
- `get_tasks`: `WHERE date BETWEEN ?1 AND ?2 AND someday = 0`.
- Новая `get_someday_tasks()`: `WHERE someday = 1 ORDER BY sort_order ASC, created_at ASC`.
- Новая `set_someday(id)`: `UPDATE tasks SET someday = 1, date = 0, updated_at = ? WHERE id = ?`.
- `move_task(id, new_date)`: дополнительно `someday = 0` (перенос из «Когда-нибудь» в день).
- `rollover_overdue`: `AND someday = 0`.
- `upsert_task`: колонка `someday` в INSERT/ON CONFLICT.
- `export_to`/`import_from`: поле `"someday"` (импорт опционально, `unwrap_or(false)`), version остаётся 1.

**Тесты Rust:** V5 применяется (колонка есть, default 0); `someday` в serde round-trip (default false).

## 3. Сетка недели — 2 линии (4+3)

`WeekView` (горизонтальный режим): вместо одной flex-строки — контейнер `flex-direction: column`, два ряда:
- ряд 1: `days[0..4]` (Пн–Чт), `display: flex`, каждая колонка `flex: 1`, `minWidth: 0` (без жёстких min/max 140-360 — ширина теперь большая);
- ряд 2: `days[4..7]` (Пт–Вс), то же.
- каждый ряд `flex: 1` (половина высоты), внутри колонок — существующий вертикальный скролл `DayColumn`.
- `WeekShiftZone` и `TaskDndContext` — как раньше; календарь справа не трогаем.

## 4. Перенос текста в компактной строке (textarea)

`TaskCard` в `compact`-режиме: `<input>` заменяется на `<textarea>`:
- `rows={1}`, `resize: none`, `overflow: hidden`, авто-высота по контенту (паттерн growNotes из заметок, max-height ~4 строки → скролл);
- перенос по словам (default);
- Enter без Shift: `preventDefault` → `save()` + `onCreateNext` (как сейчас);
- Shift+Enter: перенос строки внутри текста;
- Escape: отмена редактирования; Backspace на пустом тексте у пустой задачи — удаление (как сейчас);
- blur — сохранение.
- В не-компактном виде — прежний `<input>`.

## 5. Колонка «Когда-нибудь»

**Компонент `SomedayColumn`** (новый, `src/components/SomedayColumn.tsx`):
- заголовок «Когда-нибудь», список `TaskCard` (обычный режим, без компакта), поле «+ добавить» (upsert с `someday: true, date: 0`);
- droppable-зона `somedayZoneId("sd:someday")` — принимает задачи из дней;
- ширина ~280px, скролл внутри, фон/рамка как DayColumn.

**Размещение:**
- `WeekView`: справа от сетки (рядом с календарём, на всю высоту);
- `DayView`: справа от колонки дня;
- настройка `visibility.someday` (default true) в «Интерфейс».

**Drag (drag.tsx):**
- новый id: `somedayZoneId = "sd:someday"`;
- `customCollision`: зона не исключается для задач (не `t:`, не `d:`) — падает в неё как цель;
- `onDragEnd`: `over === somedayZoneId` → `api.setSomeday(task.id)`; из «Когда-нибудь» в день — существующий `move_task` (с `someday = 0`).

**Фоллбек (api-browser-fallback.ts):** `getTasks` фильтрует `!someday`; `getSomedayTasks`, `setSomeday`, `moveTask` (снимает someday), rollover исключает someday.

## 6. Экспорт/импорт и прочее

- `"someday"` в JSON бэкапа (импорт опционально); version 1.
- SearchResults: поиск по задачам включает «Когда-нибудь»? — **да** (get_all не меняется; фронт уже получает tasks из стора — проверяется: App загружает по диапазону + someday отдельно; поиск добавит someday-задачи в пул). Простая реализация: App грузит `getTasks(range)` + `getSomedayTasks()` и объединяет в store.tasks; все виды фильтруют по `isSameDay` (someday-задачи имеют date=0 — никуда не попадут), а поиск их видит; SomedayColumn получает их через store.

## 7. Вне скоупа

- Напоминания, вложения, повторения (следующие фичи Фазы 2).
- «Блокнот» произвольных заметок без даты (выбран вариант «Когда-нибудь»-задач).

## 8. Проверка

- `cargo test --lib` (2+ теста: V5, serde someday), `cargo check`, `npx tsc --noEmit`.
- Браузер (:1100): сетка 2 линии (4+3) с читаемым текстом; перенос длинных задач в textarea (2-3 строки); «Когда-нибудь»: создание, drag задача→колонка, drag колонка→день, фильтрация из дней, rollover не трогает, настройка видимости.
- Tauri-прогон — при первом запуске приложения.
