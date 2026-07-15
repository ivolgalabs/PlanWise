# Tauri Часть 2: UX-исправления + полировка

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Исправить три UX-бага из фидбека пользователя + добавить расширяемые
строки задач и корректную адаптивность. Завершить tweek-style MVP.

**Проблемы (из фидбека):**
1. DayView не имеет inline-поля ввода задач.
2. Нет «строчек» — готовых строк с возможностью расширения (каждая задача
   занимает строку, можно нажать Enter → новая пустая строка ниже).
3. Интерфейс не перестраивается при ресайзе окна (MiniCalendar не исчезает).

---

## Task 1: DayView с inline-полем ввода

**Files:** Modify `src/views/DayView.tsx`

Добавить поле ввода внизу списка задач (как в DayColumn): печатай → Enter →
задача создаётся на этот день. Переиспользовать логику `addTask` из DayColumn.

## Task 2: Расширяемые строки задач (tweek-style lines)

**Files:** Modify `src/components/TaskCard.tsx`, `src/components/DayColumn.tsx`

Переделать карточку из «блока с кнопкой ●» в **строку**:
- Каждая задача = одна строка: `[чекбокс] текст задачи (inline-edit)`.
- Цвет сета — тонкая цветная полоска слева строки, не заливка фона.
- **Enter в редактируемой строке** → сохраняет + создаёт новую пустую строку
  ниже (расширение). **Backspace в пустой строке** → удаляет её.
- Меню цвета/удаления — по правому клику или кнопке при hover справа.

Так список выглядит как блокнот tweek, а не как набор карточек.

## Task 3: Корректная адаптивность при ресайзе окна

**Files:** Modify `src/App.tsx`

Заменить `window.addEventListener('resize')` на `window.matchMedia('(min-width: 720px)')`
с listener'ом — надёжнее в Tauri WebView. MiniCalendar скрывается < 720px,
неделя переключается горизонталь↔вертикаль. Добавить debounce.

## Task 4: Авто-перенос невыполненных задач на сегодня (Automate)

**Files:** 
- Create `src-tauri/src/commands.rs` add `rollover_overdue` command
- Modify `src/App.tsx` вызывать при старте

При запуске: все невыполненные задачи прошлых дней (is_done=0, date < сегодня)
переносятся на сегодня. Плашка «Перенесено N задач».

## Task 5: Темы (paper-white / тёмная / холодная)

**Files:** Create `src/theme.ts` theme-switch, Modify store/settings/App

CSS-переменные, переключение в Настройках. Минимум 3 пресета.

## Task 6: Smoke-проверка на tauri dev

Запустить, проверить: inline-ввод в DayView, расширяемые строки, ресайз окна,
авто-перенос, темы.
