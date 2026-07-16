/**
 * Темы делегируются в Universal UI (universal-ui/themes.css).
 * Здесь — только список доступных тем для UI-пикера и хелперы.
 */

export type ThemeMode = "light" | "dark" | "oled";

export interface ThemeDef {
  /** id атрибута data-theme в Universal UI */
  id: string;
  /** Человекочитаемое название */
  label: string;
  /** Палитра (группа) */
  palette: string;
  /** Режим освещённости */
  mode: ThemeMode;
  /** Категория для UI-пикера */
  tier: "recommended" | "optional" | "hidden";
}

/** Все 24 темы Universal UI (8 палитр × 3 режима). */
const PALETTES = [
  { palette: "slate", label: "Slate", tier: "recommended" as const, accent: "#4c5699" },
  { palette: "sepia", label: "Sepia", tier: "recommended" as const, accent: "#a0522d" },
  { palette: "evergreen", label: "Evergreen", tier: "recommended" as const, accent: "#2d6a4f" },
  { palette: "nord", label: "Nord", tier: "recommended" as const, accent: "#5e81ac" },
  { palette: "midnight", label: "Midnight", tier: "optional" as const, accent: "#3060e8" },
  { palette: "dracula", label: "Dracula", tier: "optional" as const, accent: "#9444d6" },
  { palette: "amber", label: "Amber", tier: "hidden" as const, accent: "#d35400" },
  { palette: "sakura", label: "Sakura", tier: "hidden" as const, accent: "#d87093" },
];

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Светлая",
  dark: "Тёмная",
  oled: "OLED",
};

export const ALL_THEMES: ThemeDef[] = PALETTES.flatMap((p) =>
  (["light", "dark", "oled"] as ThemeMode[]).map((mode) => ({
    id: `${mode}-${p.palette}`,
    label: `${p.label} · ${MODE_LABEL[mode]}`,
    palette: p.palette,
    mode,
    tier: p.tier,
  })),
);

/** Получить HEX акцента палитры (для образца в пикере). */
export const paletteAccent = (palette: string): string =>
  PALETTES.find((p) => p.palette === palette)?.accent ?? "#4c5699";

/** Применить тему: выставляет data-theme на <html>. */
export const applyTheme = (themeId: string) => {
  document.documentElement.setAttribute("data-theme", themeId);
};

// Для обратной совместимости: COLORS читает CSS-переменные Universal UI.
export const COLORS = {
  paper: "var(--bg-primary)",
  card: "var(--bg-secondary)",
  cardBorder: "var(--border-color)",
  muted: "var(--text-muted)",
  text: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  accent: "var(--accent)",
  hover: "var(--bg-hover)",
  tertiary: "var(--bg-tertiary)",
  // Маркеры задач — фиксированные насыщенные (отвязаны от accent)
  setNone: "var(--bg-tertiary)",
  setWork: "#c9a87c",
  setPersonal: "#7eb8c4",
  setSport: "#e8a87c",
} as const;

export const colorSetHex = (id: string | null): string => {
  switch (id) {
    case "cs-work":
      return COLORS.setWork;
    case "cs-personal":
      return COLORS.setPersonal;
    case "cs-sport":
      return COLORS.setSport;
    default:
      return COLORS.setNone;
  }
};

/** ARGB-int (из Rust) -> #RRGGBB. */
export const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};
