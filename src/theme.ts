/** Темы ежедневника. Каждая тема задаёт CSS-переменные на :root. */

export type ThemeKind = "paper" | "dark" | "cold";

interface ThemeDef {
  label: string;
  vars: Record<string, string>;
}

export const THEMES: Record<ThemeKind, ThemeDef> = {
  paper: {
    label: "Paper-white",
    vars: {
      "--bg": "#FAF7F0",
      "--card": "#FFFFFF",
      "--card-border": "#E8E2D4",
      "--muted": "#9A8F7A",
      "--text": "#5A5240",
      "--accent": "#C9A87C",
      "--set-none": "#F0ECE2",
      "--set-work": "#C9A87C",
      "--set-personal": "#7EB8C4",
      "--set-sport": "#E8A87C",
    },
  },
  dark: {
    label: "Тёмная",
    vars: {
      "--bg": "#1E1B16",
      "--card": "#2A2620",
      "--card-border": "#3A352C",
      "--muted": "#8A8170",
      "--text": "#E8E2D4",
      "--accent": "#D4B08C",
      "--set-none": "#3A352C",
      "--set-work": "#C9A87C",
      "--set-personal": "#7EB8C4",
      "--set-sport": "#E8A87C",
    },
  },
  cold: {
    label: "Холодная",
    vars: {
      "--bg": "#EEF2F5",
      "--card": "#FFFFFF",
      "--card-border": "#D6DEE4",
      "--muted": "#7A8896",
      "--text": "#3A4654",
      "--accent": "#6B8FAE",
      "--set-none": "#D6DEE4",
      "--set-work": "#6B8FAE",
      "--set-personal": "#9DB4C7",
      "--set-sport": "#7AA8B8",
    },
  },
};

/** Применить тему: выставляет CSS-переменные на :root. */
export const applyTheme = (kind: ThemeKind) => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[kind].vars)) {
    root.style.setProperty(k, v);
  }
};

// Совместимость: COLORS читает CSS-переменные, чтобы компоненты автоматически
// перекрашивались при смене темы. Fallback — paper-значения.
export const COLORS = {
  paper: "var(--bg)",
  card: "var(--card)",
  cardBorder: "var(--card-border)",
  muted: "var(--muted)",
  text: "var(--text)",
  accent: "var(--accent)",
  setNone: "var(--set-none)",
  setWork: "var(--set-work)",
  setPersonal: "var(--set-personal)",
  setSport: "var(--set-sport)",
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
