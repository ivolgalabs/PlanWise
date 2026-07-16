/**
 * Темы Universal UI.
 * Двухосевая модель: РЕЖИМ (light/dark/auto) × ПАЛИТРА (slate/sepia/...).
 * Режим auto следует за системным prefers-color-scheme.
 */

export type ThemeMode = "light" | "dark" | "oled";
/** Режим, который выбирает юзер в настройках. */
export type ModePref = "light" | "dark" | "auto";

export interface PaletteDef {
  id: string;
  label: string;
  tier: "recommended" | "optional" | "hidden";
  accent: string;
}

/** 8 палитр (только группы, режим выбирается отдельно). */
export const PALETTES: PaletteDef[] = [
  { id: "slate", label: "Slate", tier: "recommended", accent: "#4c5699" },
  { id: "sepia", label: "Sepia", tier: "recommended", accent: "#a0522d" },
  { id: "evergreen", label: "Evergreen", tier: "recommended", accent: "#2d6a4f" },
  { id: "nord", label: "Nord", tier: "recommended", accent: "#5e81ac" },
  { id: "midnight", label: "Midnight", tier: "optional", accent: "#3060e8" },
  { id: "dracula", label: "Dracula", tier: "optional", accent: "#9444d6" },
  { id: "amber", label: "Amber", tier: "hidden", accent: "#d35400" },
  { id: "sakura", label: "Sakura", tier: "hidden", accent: "#d87093" },
];

export const MODE_LABEL: Record<ModePref, string> = {
  light: "Светлая",
  dark: "Тёмная",
  auto: "Авто",
};

/** Реальный режим (учитывая auto). */
export const resolveMode = (pref: ModePref): ThemeMode => {
  if (pref !== "auto") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

/** Применить тему: data-theme="<mode>-<palette>" на <html>. */
export const applyTheme = (palette: string, modePref: ModePref) => {
  const mode = resolveMode(modePref);
  document.documentElement.setAttribute("data-theme", `${mode}-${palette}`);
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
