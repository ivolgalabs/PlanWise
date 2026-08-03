/**
 * Темы Universal UI.
 * 8 палитр × 3 режима (light/dark/oled) = 24 темы.
 * Плюс режим "system" (следует за prefers-color-scheme).
 */

import type { ColorSet } from "./api";

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
} as const;

/**
 * HEX цвета категории по её ARGB из БД. null, если категории нет
 * (задача без категории или сет удалён).
 */
export const setHex = (sets: ColorSet[], id: string | null): string | null => {
  if (!id) return null;
  const s = sets.find((c) => c.id === id);
  return s ? argbToHex(s.color) : null;
};

/** HEX (#RRGGBB) -> ARGB int (0xFFRRGGBB) для БД. */
export const hexToArgb = (hex: string): number => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0xff << 24) | (r << 16) | (g << 8) | b;
};

/**
 * Тон CSS-переменной с прозрачностью (валидный CSS через color-mix).
 * ВАЖНО: нельзя писать `var(--x) + "26"` — это невалидное значение,
 * браузер молча отбрасывает декларацию, и подсветка не отображается.
 */
export const varTint = (variable: string, alpha: number): string =>
  `color-mix(in srgb, var(${variable}) ${Math.round(alpha * 100)}%, transparent)`;

/** Акцент с прозрачностью. */
export const accentTint = (alpha: number): string => varTint("--accent", alpha);

export const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};

// ── Свой выбор (конструктор стиля, как в TensorMedia) ──────────────────────

/** Слот пользовательского стиля: перекрывает акцент/фон предпочитаемой темы. */
export interface CustomSlot {
  name: string;
  accent: string | null;
  bgType: "light" | "dark" | "oled" | "auto";
  bgColor: string | null;
}

/** Сохранённый стиль библиотеки «Мои стили» (сериализуется в TMT-код). */
export interface ThemePreset {
  id: string;
  name: string;
  theme: string;
  accent: string | null;
  bgMode: "theme" | "light" | "dark" | "oled";
  bgColor: string | null;
  slot: "light" | "dark" | null;
}

/** Палитра акцентов конструктора. */
export const ACCENTS = ["#e11d48", "#f43f5e", "#ff6b6b", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#3b82f6", "#2563eb", "#8b5cf6"];
/** Оттенки фона: светлые и тёмные пресеты. */
export const LIGHT_SHADES = ["#fcfaf2", "#faf4ed", "#fdf6e3", "#f4f0ec", "#f5f5f5", "#ffffff"];
export const DARK_SHADES = ["#1a130f", "#1e1b18", "#1a1b26", "#0f1013", "#17181c", "#000000"];

const hexRgb = (hex: string): [number, number, number] | null => {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const c = hexRgb(hex);
  return c ? { r: c[0], g: c[1], b: c[2] } : null;
};

/** Смешать hex с целевым цветом (amt 0..1). */
function mixHex(hex: string, target: number, amt: number): string {
  const c = hexRgb(hex);
  if (!c) return hex;
  const m = (a: number, z: number) => Math.round(a * (1 - amt) + z * amt);
  const t = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  return `#${t(m(c[0], (target >> 16) & 255))}${t(m(c[1], (target >> 8) & 255))}${t(m(c[2], target & 255))}`;
}
export const darken = (hex: string, amt: number) => mixHex(hex, 0x000000, amt);
export const lighten = (hex: string, amt: number) => mixHex(hex, 0xffffff, amt);

/** Яркость hex (0..1) — для подбора текста под кастомный фон. */
export const luminance = (hex: string): number => {
  const c = hexRgb(hex);
  if (!c) return 0.5;
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
};

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function hexToHue(hex: string): number {
  const c = hexRgb(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return Math.round((hue * 60 + 360) % 360);
}

/** Автоопределение принадлежности стиля: яркость фона → светлый/тёмный. */
export const autoSlotFor = (p: { bgColor: string | null; bgMode?: string; theme: string }): "light" | "dark" => {
  if (p.bgColor) return luminance(p.bgColor) >= 0.5 ? "light" : "dark";
  if (p.bgMode === "light") return "light";
  if (p.bgMode === "dark" || p.bgMode === "oled") return "dark";
  return p.theme.startsWith("light-") ? "light" : "dark";
};

/**
 * Применить слот пользовательского стиля (или снять, если null): акцент и фон
 * inline-переменными поверх data-theme. isDark — текущий тёмный режим (для
 * авто-фона и текста). Порт логики TensorMedia.
 */
export function applyCustomSlot(
  root: HTMLElement,
  slot: CustomSlot | null,
  isDark: boolean,
): void {
  // 1. Акцент слота.
  if (slot?.accent) {
    const rgb = hexToRgb(slot.accent);
    if (rgb) {
      root.style.setProperty("--accent", slot.accent);
      root.style.setProperty("--accent-hover", darken(slot.accent, 0.12));
      root.style.setProperty("--accent-glow", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
      root.style.setProperty("--row-selected", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`);
    }
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-glow");
    root.style.removeProperty("--row-selected");
  }

  // 2. Фон слота (перекрывает фон темы; текст адаптируется по яркости).
  if (slot?.bgColor) {
    const t = slot.bgType === "auto" ? (isDark ? "dark" : "light") : slot.bgType;
    if (t === "oled") {
      root.style.setProperty("--bg-primary", "#000000");
      root.style.setProperty("--bg-secondary", "#0a0a0a");
      root.style.setProperty("--bg-tertiary", "#121212");
      root.style.setProperty("--bg-hover", "#1c1c1c");
      root.style.setProperty("--border-color", "#242424");
    } else if (t === "light") {
      const bg = slot.bgColor;
      root.style.setProperty("--bg-primary", bg);
      root.style.setProperty("--bg-secondary", darken(bg, 0.04));
      root.style.setProperty("--bg-tertiary", darken(bg, 0.08));
      root.style.setProperty("--bg-hover", darken(bg, 0.12));
      root.style.setProperty("--border-color", darken(bg, 0.18));
    } else {
      const bg = slot.bgColor;
      root.style.setProperty("--bg-primary", bg);
      root.style.setProperty("--bg-secondary", lighten(bg, 0.04));
      root.style.setProperty("--bg-tertiary", lighten(bg, 0.08));
      root.style.setProperty("--bg-hover", lighten(bg, 0.12));
      root.style.setProperty("--border-color", lighten(bg, 0.18));
    }
    const lum = luminance(slot.bgColor);
    root.style.setProperty("--text-primary", lum > 0.5 ? "#1f2329" : "#f2f3f5");
    root.style.setProperty("--text-secondary", lum > 0.5 ? "#5a616c" : "#949ba4");
    root.style.setProperty("--text-muted", lum > 0.5 ? "#8a919c" : "#6a6f77");
  } else {
    root.style.removeProperty("--bg-primary");
    root.style.removeProperty("--bg-secondary");
    root.style.removeProperty("--bg-tertiary");
    root.style.removeProperty("--bg-hover");
    root.style.removeProperty("--border-color");
    root.style.removeProperty("--text-primary");
    root.style.removeProperty("--text-secondary");
    root.style.removeProperty("--text-muted");
  }
}


