/**
 * Темы и цвета — ЕДИНЫЙ источник в Universal UI (theme-block/themeModel.ts).
 * Этот файл — тонкий реэкспорт, чтобы все импорты "../theme" в приложении
 * продолжали работать. Сами данные (палитры, семейства, акценты, оттенки,
 * хелперы) живут глобально и синхронизированы с themes.css (11 семейств).
 *
 * РЕЭКСПОРТ ЧЕРЕЗ themeModel.ts НАПРЯМУЮ (не через index.ts): index тянет
 * компонент ThemeSettings.tsx (React-порт блока оформления), а он не входит
 * в зависимости этого приложения.
 */

import type { CustomSlot as UuiCustomSlot, ThemePreset as UuiThemePreset } from "universal-ui/theme-block/themeModel";
export type { CustomSlot } from "universal-ui/theme-block/themeModel";

// Локальный ThemePreset: в этом приложении тема хранится строкой (может
// быть и не из канонического списка ThemeId, например при импорте TMT-кода).
// В theme-block тема типизирована строго (ThemeId) — здесь ослабляем.
export type ThemePreset = Omit<UuiThemePreset, "theme"> & { theme: string };

// Значения и хелперы — из глобальной модели Universal UI.
export {
  PALETTES,
  THEME_FAMILIES,
  FAMILIES,
  ACCENTS,
  LIGHT_SHADES,
  DARK_SHADES,
  applyTheme,
  watchSystemTheme,
  COLORS,
  varTint,
  accentTint,
  hexToArgb,
  argbToHex,
  hslToHex,
  hexToHue,
  autoSlotFor,
  applyCustomSlot,
  setHex,
} from "universal-ui/theme-block/themeModel";

export type {
  ThemeId,
  ThemeMode,
  PaletteDef,
  ThemeFamily,
  ThemeFamilyModes,
} from "universal-ui/theme-block/themeModel";

// Для типов, где нужен именно UUI-вариант (theme: ThemeId), например
// store.ts не использует, но экспортируем на случай внешнего потребления.
export type { UuiCustomSlot, UuiThemePreset };
