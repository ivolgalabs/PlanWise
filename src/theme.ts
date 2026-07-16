/**
 * Темы Universal UI.
 * 8 палитр × 3 режима (light/dark/oled) = 24 темы.
 * Плюс режим "Авто" (следует за prefers-color-scheme).
 */

export type ThemeMode = "light" | "dark" | "oled";

export interface PaletteDef {
  id: string;
  label: string;
  accent: string;
}

export interface FullTheme {
  /** id для data-theme: "light-slate" и т.д. */
  id: string;
  palette: string;
  mode: ThemeMode;
  label: string;
}

/** 8 палитр. */
export const PALETTES: PaletteDef[] = [
  { id: "slate", label: "Slate", accent: "#4c5699" },
  { id: "sepia", label: "Sepia", accent: "#a0522d" },
  { id: "evergreen", label: "Evergreen", accent: "#2d6a4f" },
  { id: "nord", label: "Nord", accent: "#5e81ac" },
  { id: "midnight", label: "Midnight", accent: "#3060e8" },
  { id: "dracula", label: "Dracula", accent: "#9444d6" },
  { id: "amber", label: "Amber", accent: "#d35400" },
  { id: "sakura", label: "Sakura", accent: "#d87093" },
];

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Светлая",
  dark: "Тёмная",
  oled: "OLED",
};

/** Все 24 темы (8 палитр × 3 режима). */
export const ALL_THEMES: FullTheme[] = PALETTES.flatMap((p) =>
  (["light", "dark", "oled"] as ThemeMode[]).map((mode) => ({
    id: `${mode}-${p.id}`,
    palette: p.id,
    mode,
    label: `${p.label} · ${MODE_LABEL[mode]}`,
  })),
);

/** Получить HEX акцента палитры. */
export const paletteAccent = (palette: string): string =>
  PALETTES.find((p) => p.id === palette)?.accent ?? "#4c5699";

/**
 * Применить тему. Принимает либо полный id ("light-slate"),
 * либо "auto" — тогда следует за системным prefers-color-scheme.
 */
export const applyTheme = (themeId: string) => {
  document.documentElement.setAttribute("data-theme", themeId);
};

/** Слушатель системной темы для режима auto. Возвращает функцию отписки. */
export const watchSystemTheme = (onChange: () => void) => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
};

// COLORS — читает CSS-переменные Universal UI.
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

export const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};

