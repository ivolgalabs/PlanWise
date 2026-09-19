// ─── Модель оформления (общий модуль Universal UI) ───
// Типы и хелперы для ThemeSettings.tsx (React-порт блока оформления).
// Источник данных тем (24 темы) синхронизирован с themes.css.

export type ThemeId =
  // Light (11)
  | "light-slate" | "light-nord" | "light-midnight" | "light-dracula" | "light-sepia"
  | "light-evergreen" | "light-amber" | "light-sakura"
  | "light-terra" | "light-indigo" | "light-sage"
  // Dark (11)
  | "dark-slate" | "dark-nord" | "dark-midnight" | "dark-dracula" | "dark-sepia"
  | "dark-evergreen" | "dark-amber" | "dark-sakura"
  | "dark-terra" | "dark-indigo" | "dark-sage"
  // OLED (11)
  | "oled-slate" | "oled-nord" | "oled-midnight" | "oled-dracula" | "oled-sepia"
  | "oled-evergreen" | "oled-amber" | "oled-sakura"
  | "oled-terra" | "oled-indigo" | "oled-sage";

export type ThemeMode = "light" | "dark" | "system";

// Слот пользовательского стиля (применяется поверх предпочитаемой темы).
export interface CustomSlot {
  name: string;
  accent: string | null;
  bgType: "light" | "dark" | "oled" | "auto";
  bgColor: string | null;
}

// Сохранённый стиль (библиотека «Мои стили»), сериализуется в TMT-код.
export interface ThemePreset {
  id: string;
  name: string;
  theme: ThemeId;
  accent: string | null;
  bgMode: "theme" | "light" | "dark" | "oled";
  bgColor: string | null;
  slot: "light" | "dark" | null;
}

export const DARK_THEMES: ThemeId[] = [
  "dark-slate", "dark-nord", "dark-midnight", "dark-dracula", "dark-sepia",
  "dark-evergreen", "dark-amber", "dark-sakura",
  "dark-terra", "dark-indigo", "dark-sage",
];
export const LIGHT_THEMES: ThemeId[] = [
  "light-slate", "light-nord", "light-midnight", "light-dracula", "light-sepia",
  "light-evergreen", "light-amber", "light-sakura",
  "light-terra", "light-indigo", "light-sage",
];
export const OLED_THEMES: ThemeId[] = [
  "oled-slate", "oled-nord", "oled-midnight", "oled-dracula", "oled-sepia",
  "oled-evergreen", "oled-amber", "oled-sakura",
  "oled-terra", "oled-indigo", "oled-sage",
];

export const toOled = (id: ThemeId): ThemeId => id.replace(/^(dark|light)-/, "oled-") as ThemeId;
export const isLightTheme = (id: ThemeId) => id.startsWith("light-");

// Короткое имя темы без префикса «[Цвет]» — для триггера и статуса.
const SHORT_NAMES: Record<string, string> = {
  "light-slate": "Daylight", "light-nord": "Nord Light", "light-midnight": "Neon Morning",
  "light-dracula": "Daylight Dracula", "light-sepia": "Sepia Light", "light-evergreen": "Evergreen Light",
  "light-amber": "Amber Light", "light-sakura": "Sakura Light",
  "light-terra": "Terra Light", "light-indigo": "Indigo Light", "light-sage": "Sage Light",
  "dark-slate": "Slate", "dark-nord": "Nord Dark", "dark-midnight": "Midnight",
  "dark-dracula": "Dracula", "dark-sepia": "Sepia Dark", "dark-evergreen": "Evergreen Dark",
  "dark-amber": "Amber Dark", "dark-sakura": "Sakura Dark",
  "dark-terra": "Terra Dark", "dark-indigo": "Indigo Dark", "dark-sage": "Sage Dark",
  "oled-slate": "OLED Slate", "oled-nord": "OLED Nord", "oled-midnight": "OLED Midnight",
  "oled-dracula": "OLED Dracula", "oled-sepia": "OLED Sepia", "oled-evergreen": "OLED Evergreen",
  "oled-amber": "OLED Amber", "oled-sakura": "OLED Sakura",
  "oled-terra": "OLED Terra", "oled-indigo": "OLED Indigo", "oled-sage": "OLED Sage",
};
export const shortThemeName = (id: ThemeId) => SHORT_NAMES[id] || id;

// ── Цветовые хелперы ──
export function mixHex(hex: string, target: number, amt: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const m = (a: number, z: number) => Math.round(a * (1 - amt) + z * amt);
  const t = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
  return `#${t(m(r, (target >> 16) & 255))}${t(m(g, (target >> 8) & 255))}${t(m(b, target & 255))}`;
}
export const darken = (hex: string, amt: number) => mixHex(hex, 0x000000, amt);
export const lighten = (hex: string, amt: number) => mixHex(hex, 0xffffff, amt);

export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function hexToHue(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return Math.round((hue * 60 + 360) % 360);
}

// Автоопределение принадлежности стиля: яркость фона → светлый/тёмный.
export function autoSlotFor(p: { bgColor: string | null; bgMode?: string; theme: string }): "light" | "dark" {
  if (p.bgColor) return luminance(p.bgColor) >= 0.5 ? "light" : "dark";
  if (p.bgMode === "light") return "light";
  if (p.bgMode === "dark" || p.bgMode === "oled") return "dark";
  return isLightTheme(p.theme as ThemeId) ? "light" : "dark";
}

// ── Данные тем для свотчей (те же 24, что в themes.css; OLED — галочкой) ──
export interface ThemeFamily {
  family: string;
  label: string;
  accent: string;
  light: [string, string];
  dark: [string, string];
}
export const FAMILIES: ThemeFamily[] = [
  { family: "slate",    label: "Slate",     accent: "#4c5699", light: ["#f4f5f7", "#1f2329"], dark: ["#0f1013", "#f2f3f5"] },
  { family: "nord",     label: "Nord",      accent: "#5e81ac", light: ["#eceff4", "#2e3440"], dark: ["#2e3440", "#eceff4"] },
  { family: "midnight", label: "Midnight",  accent: "#3060e8", light: ["#f0f4fe", "#1a1b26"], dark: ["#1a1b26", "#c0caf5"] },
  { family: "dracula",  label: "Dracula",   accent: "#9444d6", light: ["#f6f3fc", "#282a36"], dark: ["#282a36", "#f8f8f2"] },
  { family: "sepia",    label: "Sepia",     accent: "#a0522d", light: ["#fcfaf2", "#433422"], dark: ["#1e1b18", "#efebe4"] },
  { family: "evergreen",label: "Evergreen", accent: "#2d6a4f", light: ["#f1f7f4", "#1c2e24"], dark: ["#0f1a14", "#e2e8e6"] },
  { family: "amber",    label: "Amber",     accent: "#d35400", light: ["#fffdf5", "#3d321d"], dark: ["#1a130f", "#fdf5f0"] },
  { family: "sakura",   label: "Sakura",    accent: "#d87093", light: ["#fff0f5", "#5c2c3a"], dark: ["#1f1619", "#ffd1dc"] },
  // Дополнительные проверочные палитры (синхронно с themes.css).
  { family: "terra",    label: "Terra",     accent: "#e8612f", light: ["#f2f1ec", "#3a362e"], dark: ["#1e1d1a", "#eceae5"] },
  { family: "indigo",   label: "Indigo",    accent: "#56568c", light: ["#f2f1ec", "#3a362e"], dark: ["#1e1d1a", "#eceae5"] },
  { family: "sage",     label: "Sage",      accent: "#75894d", light: ["#f2f1ec", "#3a362e"], dark: ["#1e1d1a", "#eceae5"] },
];

export const ACCENTS = ["#e11d48", "#f43f5e", "#ff6b6b", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#3b82f6", "#2563eb", "#8b5cf6"];
export const LIGHT_SHADES = ["#fcfaf2", "#faf4ed", "#fdf6e3", "#f4f0ec", "#f5f5f5", "#ffffff"];
export const DARK_SHADES = ["#1a130f", "#1e1b18", "#1a1b26", "#0f1013", "#17181c", "#000000"];

// ── Палитры и семейства для свотчей приложений ───────────────────────────
// Полный список (11 семейств), синхронный с themes.css. bg/text для light/dark
// берём из themes.css; OLED — чёрный фон с текстом тёмной темы.

export interface PaletteDef {
  id: string;
  label: string;
  accent: string;
}

export const PALETTES: PaletteDef[] = FAMILIES.map((f) => ({
  id: f.family,
  label: f.label,
  accent: f.accent,
}));

/** Семейство тем со свотчами трёх режимов (light/dark/oled) — форма
 *  ежедневника (src/theme.ts THEME_FAMILIES), теперь глобальная. */
export interface ThemeFamilyModes {
  family: string;
  label: string;
  accent: string;
  modes: { id: string; name: string; bg: string; text: string }[];
}

export const THEME_FAMILIES: ThemeFamilyModes[] = FAMILIES.map((f) => {
  const base = f.dark[1];
  return {
    family: f.family,
    label: f.label,
    accent: f.accent,
    modes: [
      { id: `light-${f.family}`, name: "Light", bg: f.light[0], text: f.light[1] },
      { id: `dark-${f.family}`,  name: "Dark",  bg: f.dark[0],  text: f.dark[1] },
      { id: `oled-${f.family}`,  name: "OLED",  bg: "#000000",   text: base },
    ],
  };
});

// ── Применение тем и CSS-переменные (порт из ежедневника) ───────────────

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

/** Читает CSS-переменные Universal UI (цвета зависят от активной темы). */
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
 * Тон CSS-переменной с прозрачностью (валидный CSS через color-mix).
 * ВАЖНО: нельзя писать `var(--x) + "26"` — это невалидное значение,
 * браузер молча отбрасывает декларацию.
 */
export const varTint = (variable: string, alpha: number): string =>
  `color-mix(in srgb, var(${variable}) ${Math.round(alpha * 100)}%, transparent)`;

/** Акцент с прозрачностью. */
export const accentTint = (alpha: number): string => varTint("--accent", alpha);

/** HEX (#RRGGBB) -> ARGB int (0xFFRRGGBB) для БД. */
export const hexToArgb = (hex: string): number => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0xff << 24) | (r << 16) | (g << 8) | b;
};

export const argbToHex = (argb: number): string => {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
};

/** HEX -> {r,g,b}. null, если не hex. */
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

/**
 * Применить слот пользовательского стиля (или снять, если null): акцент и фон
 * inline-переменными поверх data-theme. isDark — текущий тёмный режим (для
 * авто-фона и текста). Порт логики ежедневника/TensorMedia.
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

/** HEX цвета категории по её ARGB из БД. null, если категории нет. */
export const setHex = (sets: { id: string; color: number }[], id: string | null): string | null => {
  if (!id) return null;
  const s = sets.find((c) => c.id === id);
  return s ? argbToHex(s.color) : null;
};
