/** Палитра ежедневника в стиле tweek.so. */

export const COLORS = {
  paper: "#FAF7F0",
  card: "#FFFFFF",
  cardBorder: "#E8E2D4",
  muted: "#9A8F7A",
  text: "#5A5240",
  accent: "#C9A87C",
  setNone: "#F0ECE2",
  setWork: "#C9A87C",
  setPersonal: "#7EB8C4",
  setSport: "#E8A87C",
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
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
};
