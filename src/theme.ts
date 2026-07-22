/**
 * Темы Universal UI.
 * 8 палитр × 3 режима (light/dark/oled) = 24 темы.
 * Плюс режим "system" (следует за prefers-color-scheme).
 */

export type ThemeMode = "light" | "dark" | "oled";

export interface PaletteDef {
  id: string;
  label: string;
  accent: string;
}

export interface ThemeFamily {
  family: string;
  label: string;
  accent: string;
  modes: { id: string; name: string; bg: string; text: string }[];
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

/** Семьи тем для свотчей с превью фона/текста (как в multispend-tracker). */
export const THEME_FAMILIES: ThemeFamily[] = PALETTES.map((p) => {
  // bg/text берём из Universal UI themes.css для каждого режима.
  const meta: Record<string, { light: [string, string]; dark: [string, string] }> = {
    slate:     { light: ["#f4f5f7", "#1f2329"], dark: ["#0f1013", "#f2f3f5"] },
    sepia:     { light: ["#fcfaf2", "#433422"], dark: ["#1e1b18", "#efebe4"] },
    evergreen: { light: ["#f1f7f4", "#1c2e24"], dark: ["#0f1a14", "#e2e8e6"] },
    nord:      { light: ["#eceff4", "#2e3440"], dark: ["#2e3440", "#eceff4"] },
    midnight:  { light: ["#f0f4fe", "#1a1b26"], dark: ["#1a1b26", "#c0caf5"] },
    dracula:   { light: ["#f6f3fc", "#282a36"], dark: ["#282a36", "#f8f8f2"] },
    amber:     { light: ["#fffdf5", "#3d321d"], dark: ["#1a130f", "#fdf5f0"] },
    sakura:    { light: ["#fff0f5", "#5c2c3a"], dark: ["#1f1619", "#ffd1dc"] },
  };
  const m = meta[p.id];
  return {
    family: p.id,
    label: p.label,
    accent: p.accent,
    modes: [
      { id: `light-${p.id}`, name: "Light", bg: m.light[0], text: m.light[1] },
      { id: `dark-${p.id}`,  name: "Dark",  bg: m.dark[0],  text: m.dark[1] },
      { id: `oled-${p.id}`,  name: "OLED",  bg: "#000000",   text: m.dark[1] },
    ],
  };
});

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Светлая",
  dark: "Тёмная",
  oled: "OLED",
};

export interface FullTheme {
  id: string;
  palette: string;
  mode: ThemeMode;
  label: string;
}

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

/** Применить тему по полному id ("light-slate" и т.д.). */
export const applyTheme = (themeId: string) => {
  document.documentElement.setAttribute("data-theme", themeId);
};

/** Слушатель системной темы. Возвращает функцию отписки. */
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


