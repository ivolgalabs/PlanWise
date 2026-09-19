# Universal UI — единая дизайн-система

Общая база тем, токенов, компонентов, иконок и языков для всех приложений
(Tauri/React, Qt/PySide6 и др.). Идея: **общий стиль под общей эгидой, но каждое
приложение остаётся собой** — берёт нужные слои и при необходимости
переопределяет презентацию (пример: TensorMedia использует accent-заливку
активного сегмента в `.segmented-control` — это легитимное прикладное отличие).

## Слои

| Файл | Что даёт |
|------|----------|
| `tokens.css` | spacing (4px-база), radius, elevation, z-index, motion, control-sizing, `--chart-*` |
| `themes.css` | 24 темы (8 баз × light/dark/oled) + цветовые пары `-bg/-border`; `--accent-hover` выводится из `--accent` |
| `typography.css` | `--font-ui` (Inter), `--font-mono`, шкала `--fs-2xs…3xl` |
| `components.css` | базовые кнопки, слайдеры, скроллбары, select, checkbox, glass-panel, segmented-control, модалки, 38px-грид, «плавающий остров» (`unified-scrubber-box`) |
| `badges.css` | `.badge` + семантики keep/del/ref/inbox |
| `buttons.css` | `.btn-primary / .btn-danger / .btn-danger-outline / .btn-ghost / .btn-icon` |
| `context-menu.css` | `.ctx-menu` / `.ctx-backdrop` |
| `toolbar.css` | `.toolbar`, `.filter-search`, `.search-input-wrapper`, `.results-count` |
| `empty-state.css` | `.empty-state`, `.spinner` |
| `icons.css` | 169 иконок feather-стиля через CSS-маски (цвет — `currentColor`): база (файлы/плеер/темы) + общие (действия/навигация) + финансовые + сеть/устройства (wifi, bluetooth, server, qr) + система (terminal, shield, hard-drive) + магазин (crown, badge, gift) — 100% покрытие TensorMedia, multispend, todo, share-drop, «Синхронизация», сайт-портфолио |
| `theme-status.css` | блок «Текущий статус оформления», вкладки «Стандартные/Свой выбор», свотчи с галочкой, switch, конструктор своего стиля (акцент/фон/пресеты) |
| `ui-scale.css` | масштаб интерфейса (`--ui-scale`) и размер шрифта (`--font-scale`): px-токены через calc, секции настроек `.scale-section` |
| `toast.css` | тосты: `.toast-stack` / `.toast` + состояния success/error/info (непрозрачный фон, цветная полоса, иконка), анимации toast-in/toast-out |
| `motion.css` | `.anim-fade` / `.anim-slide-up` / `.anim-pulse` (+`.anim-infinite`) — спокойные переходы без вращений/прыжков |
| `status-bar.css` | нижняя строка состояния: `.status-bar` + `.s-text`/`.s-busy`/`.s-progress`/`.s-metrics` |
| `help.css` | капсулы клавиш `kbd` + строки справки `.help-row` |
| `app-card.css` | пара `.app-card` / `.app-card-inner` (секции настроек, дашборды) |
| `i18n/*.json` | общий словарь (76 ключей) на 8 языках (EN/RU/ES/DE/FR/PT/ZH/JA) |
| `all.css` | единый импорт всех слоёв |
| `universal_ui_bridge.py` | генератор QSS для PySide6/Qt из themes/tokens |

## Подключение (веб/React)

```css
/* в App.css приложения */
@import "../../../Universal UI/all.css";
```

Или точечно (как TensorMedia):

```css
@import "../../../Universal UI/tokens.css";
@import "../../../Universal UI/themes.css";
@import "../../../Universal UI/typography.css";
@import "../../../Universal UI/components.css";
```

### Иконки

```html
<span class="icon icon--play" />
<span class="icon icon--folder icon-lg" />
```

Цвет наследуется из `color`; размеры: `.icon-sm` (14), по умолчанию 16,
`.icon-lg` (18), `.icon-xl` (20), `.icon-hero` (64).

### Языки

JSON-словари — опциональный слой. React-приложение импортирует и **сливает** с
прикладными ключами (прикладные приоритетнее):

```ts
import ru from "../../../Universal UI/i18n/ru.json";
const t = { ...ru, ...appRu };
```

Плейсхолдеры `{count}` / `{n}` подставляются на стороне приложения.

## Масштаб интерфейса и размер шрифта (ui-scale.css)

Опциональный слой для приложений с настройкой масштаба (эталон — multispend-tracker).
Применение (JS):

```js
document.documentElement.style.fontSize = `${16 * uiScale}px`;   // rem-база
document.documentElement.style.setProperty('--ui-scale', uiScale);   // px-токены
document.documentElement.style.setProperty('--font-scale', fontScale); // --fs-*
```

- `--ui-scale` масштабирует px-токены (spacing, сетку контролов) — при >100% ничего не обрезается
- `--font-scale` масштабирует типографику `--fs-*` отдельно от интерфейса
- диапазон 0.7–1.5 (70–150%), шаг 0.05; готовые контролы — `.scale-section`, `.scale-presets`
- по умолчанию множители = 1: значения токенов не меняются, приложения без масштаба не затронуты

## Темы

`data-theme="light-slate"` и т.д. на `<html>`; без атрибута — дефолт `:root`
(light-slate). Каждая тема определяет: bg-primary/secondary/tertiary/hover,
accent(+hover+glow), success/danger/ref/inbox (+bg/border), text-*,
border-color, row-selected, shadow, glass-*, bg-translucent.

Добавление темы: блок `[data-theme="<name>"] { … }` в `themes.css` — все
потребители (включая Qt через bridge) получат её автоматически.

## Правила

- **Не хардкодь px/цвета в приложениях** — бери токены (`--sp-*`, `--radius-*`,
  `--fs-*`, `--shadow-*`); новые значения сначала попадают в `tokens.css`.
- **Не копируй** файлы UUI в проект — подключай по относительному пути
  (вендорные копии уже дважды расходились с оригиналом).
- **Не удаляй** папку — от неё зависят TensorMedia, CBZ_view, todo,
  lingo-rust, Convertor_Comics, Cutter и др.
