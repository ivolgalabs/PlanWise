// ── Блок оформления (общий модуль Universal UI / theme-block) ──────────
// React-порт превью theme-preview.html. Самодостаточен: переводы и модель тем
// берёт из соседних файлов модуля (i18n.ts, themeModel.ts), стили — из
// theme-status.css + ui-scale.css + theme-block.css (см. README.md).
// Мобильная адаптация: вкладки/карточки/пресеты рассчитаны на десктоп —
// на узких экранах требуется редизайн (см. README.md «Адаптация»).
import { useEffect, useState } from "react";
import type { ThemeLang } from "./i18n";
import { getThemeT } from "./i18n";
import {
  type ThemeId, type ThemeMode, type CustomSlot, type ThemePreset,
  FAMILIES, ACCENTS, LIGHT_SHADES, DARK_SHADES,
  toOled, isLightTheme, shortThemeName, autoSlotFor, hslToHex, hexToHue,
} from "./themeModel";

export interface ThemeSettingsProps {
  lang: ThemeLang;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  prefLight: ThemeId;
  setPrefLight: (t: ThemeId) => void;
  prefDark: ThemeId;
  setPrefDark: (t: ThemeId) => void;
  useOled: boolean;
  setUseOled: (b: boolean) => void;
  customLight: CustomSlot | null;
  setCustomLight: (s: CustomSlot | null) => void;
  customDark: CustomSlot | null;
  setCustomDark: (s: CustomSlot | null) => void;
  presets: ThemePreset[];
  setPresets: React.Dispatch<React.SetStateAction<ThemePreset[]>>;
  resolvedTheme: ThemeId;
  activeSlot: CustomSlot | null;
  draft: CustomSlot | null;
  setDraft: (d: CustomSlot | null) => void;
  zoom: number;
  setZoom: (z: number) => void;
  fontScale: number;
  setFontScale: (f: number) => void;
  systemIsDark: boolean;
  onClose: () => void;
}

const ZOOM_PRESETS = [70, 100, 125, 150, 200];
const FONT_PRESETS = [80, 100, 110, 125, 140];

// Кодирование TMT-кода (канон UUI): TMT-<тема с _ вместо ->-<accent>-<bgType L/O/D/T>-<bgHex>-<slot L/D/N>
function encodePresetCode(p: ThemePreset): string {
  const theme = p.theme.replace(/-/g, "_");
  const accent = (p.accent || "none").replace("#", "");
  const bgType = p.bgMode === "light" ? "L" : p.bgMode === "oled" ? "O" : p.bgMode === "dark" ? "D" : "T";
  const bgHex = (p.bgColor || "none").replace("#", "");
  const slot = p.slot === "light" ? "L" : p.slot === "dark" ? "D" : "N";
  return `TMT-${theme}-${accent}-${bgType}-${bgHex}-${slot}`;
}

function decodePresetCode(code: string): Omit<ThemePreset, "id" | "name"> | null {
  const parts = code.replace(/^TMT-/, "").split("-");
  if (parts.length < 4) return null;
  const [themeEnc, accent, bgType, bgHex, slotChar] = parts;
  const theme = themeEnc.replace(/_/g, "-") as ThemeId;
  if (!/^(light|dark|oled)-/.test(theme)) return null;
  const slot: "light" | "dark" | null = slotChar === "L" ? "light" : slotChar === "D" ? "dark" : null;
  return {
    theme,
    accent: accent && accent !== "none" ? `#${accent}` : null,
    bgMode: bgType === "L" ? "light" : bgType === "O" ? "oled" : bgType === "D" ? "dark" : "theme",
    bgColor: bgHex && bgHex !== "none" ? `#${bgHex}` : null,
    slot,
  };
}

export default function ThemeSettings(props: ThemeSettingsProps) {
  const {
    lang, themeMode, setThemeMode, prefLight, setPrefLight, prefDark, setPrefDark,
    useOled, setUseOled, customLight, setCustomLight, customDark, setCustomDark,
    presets, setPresets, resolvedTheme, activeSlot, draft, setDraft,
    zoom, setZoom, fontScale, setFontScale, systemIsDark, onClose,
  } = props;

  const t = getThemeT(lang);
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [presetName, setPresetName] = useState("");
  const [presetSlotSel, setPresetSlotSel] = useState<"auto" | "light" | "dark">("auto");
  const [importCode, setImportCode] = useState("");
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [hue, setHue] = useState(() => (draft?.accent ? hexToHue(draft.accent) : 0));
  const [accentHexTxt, setAccentHexTxt] = useState(draft?.accent || "");
  const [bgHexTxt, setBgHexTxt] = useState(draft?.bgColor || "");
  useEffect(() => { setAccentHexTxt(draft?.accent || ""); setBgHexTxt(draft?.bgColor || ""); }, [draft?.accent, draft?.bgColor]);

  const curDark = themeMode === "dark" || (themeMode === "system" && systemIsDark);

  const msg = (text: string, ok = true) => {
    setFlash({ text, ok });
    window.setTimeout(() => setFlash(null), 4000);
  };

  // ── Режим (Светлая / Тёмная / Системная) ──
  const handleSetMode = (m: ThemeMode) => {
    setThemeMode(m);
    const s = m === "dark" || (m === "system" && systemIsDark) ? customDark : customLight;
    setDraft(s ? { ...s } : null);
  };

  // ── OLED-галочка (только в «Стандартных») ──
  const handleOled = (on: boolean) => setUseOled(on);

  // ── Свотч базовой темы ──
  const handleSwatch = (id: ThemeId) => {
    const light = isLightTheme(id);
    if (light) { setPrefLight(id); setThemeMode("light"); setCustomLight(null); }
    else { setPrefDark(id); setThemeMode("dark"); setCustomDark(null); }
    setDraft(null);
  };

  // ── Конструктор: акцент / фон ──
  const patchDraft = (patch: Partial<CustomSlot>) => {
    setDraft({
      name: draft?.name || "Мой стиль",
      accent: draft?.accent ?? null,
      bgType: draft?.bgType ?? "auto",
      bgColor: draft?.bgColor ?? null,
      ...patch,
    });
  };
  const handleAccent = (accent: string) => patchDraft({ accent });
  const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
  const normHex = (raw: string) => "#" + raw.trim().replace(/^#/, "").toLowerCase();
  const applyAccentHex = (raw: string) => { if (HEX_RE.test(raw.trim())) { const hex = normHex(raw); handleAccent(hex); setHue(hexToHue(hex)); } };
  const applyBgHex = (raw: string) => { if (HEX_RE.test(raw.trim())) { const hex = normHex(raw); handleBgShade(hex); } };
  const commitAccentHex = (raw: string) => { const v = raw.trim(); setAccentHexTxt(HEX_RE.test(v) ? normHex(v) : (draft?.accent || "")); };
  const commitBgHex = (raw: string) => { const v = raw.trim(); setBgHexTxt(HEX_RE.test(v) ? normHex(v) : (draft?.bgColor || "")); };
  const handleBgMode = (bgMode: "theme" | "light" | "dark" | "oled") => {
    if (bgMode === "theme") {
      setDraft(draft?.accent ? { name: draft.name, accent: draft.accent, bgType: "auto", bgColor: null } : null);
    } else {
      patchDraft({ bgType: bgMode });
    }
  };
  const handleBgShade = (c: string) => {
    const bgType = LIGHT_SHADES.includes(c) ? "light" : c === "#000000" ? "oled" : "dark";
    patchDraft({ bgType, bgColor: c });
  };

  // ── Библиотека «Мои стили» ──
  // Слоты ☀️/🌙 заполняются ТОЛЬКО через «Применить» (с принадлежностью или авто
  // по содержимому) — отдельного «Сохранить как …» нет (договорённость по UUI).
  const savePreset = () => {
    let name = presetName.trim();
    if (!name) {
      let n = 1;
      while (presets.some(p => p.name === `${t.themeStyleName} #${n}`)) n++;
      name = `${t.themeStyleName} #${n}`;
    }
    if (presets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      msg(t.themeDupName.replace("{name}", name), false);
      return;
    }
    const slot = presetSlotSel === "auto"
      ? autoSlotFor({ bgColor: draft?.bgColor || null, bgMode: draft?.bgType || "theme", theme: resolvedTheme })
      : presetSlotSel;
    const preset: ThemePreset = {
      id: Math.random().toString(36).slice(2, 9),
      name,
      theme: resolvedTheme,
      accent: draft?.accent || null,
      bgMode: draft?.bgColor ? (draft.bgType === "light" ? "light" : draft.bgType === "oled" ? "oled" : "dark") : "theme",
      bgColor: draft?.bgColor || null,
      slot,
    };
    setPresets(prev => [...prev, preset]);
    setPresetName("");
    msg(t.themePresetSaved.replace("{who}", slot === "light" ? t.themeModeLight : t.themeModeDark));
  };

  const applyPreset = (p: ThemePreset) => {
    if (isLightTheme(p.theme)) setPrefLight(p.theme);
    else if (p.theme.startsWith("oled-")) { setPrefDark(p.theme.replace("oled-", "dark-") as ThemeId); setUseOled(true); }
    else setPrefDark(p.theme);
    const slot = p.slot || autoSlotFor({ bgColor: p.bgColor, bgMode: p.bgMode, theme: p.theme });
    const slotData: CustomSlot = { name: p.name, accent: p.accent, bgType: p.bgMode === "theme" ? "auto" : p.bgMode, bgColor: p.bgColor };
    if (slot === "light") setCustomLight(slotData); else setCustomDark(slotData);
    setThemeMode(slot === "light" ? "light" : "dark");
    setDraft(null);
    msg(t.themeApplied.replace("{name}", p.name).replace("{who}", slot === "light" ? t.themeModeLight : t.themeModeDark));
  };

  const copyPresetCode = (p: ThemePreset) => {
    const code = encodePresetCode(p);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).catch(() => {});
    setImportCode(code);
    msg(t.themeCodeCopied.replace("{code}", code));
  };

  const importPreset = () => {
    const p = decodePresetCode(importCode.trim());
    if (!p) { msg(t.importErrorFormat, false); return; }
    setPresets(prev => [...prev, { ...p, id: Math.random().toString(36).slice(2, 9), name: `${t.presetImported} ${shortThemeName(p.theme)}` }]);
    setImportCode("");
    msg(t.presetImportedOk);
  };

  const clearSlot = (kind: "light" | "dark") => {
    if (kind === "light") setCustomLight(null); else setCustomDark(null);
    if (curDark === (kind === "dark")) setDraft(null);
  };

  // Активный свотч: тема применена сейчас (без OLED-замены показываем базу)
  const activeBase = resolvedTheme.replace(/^oled-/, (m) => (m === "oled-" ? "dark-" : m)) as ThemeId;
  const isDraft = !!draft;

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="theme-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>{t.theme}</h2>
          <button className="modal-back-btn" onClick={onClose}><span className="icon icon--close" /></button>
        </div>
        <div className="ts-scroll">
          {/* ── A. Текущий статус оформления ── */}
          <div className="theme-status">
            <div className="theme-status-head">
              <div>
                <h3 className="theme-status-title"><span className="icon icon--palette" /> {t.themeStatusTitle}</h3>
                <p className="theme-status-subtitle">
                  {t.themeActiveLabel}: <strong>{shortThemeName(resolvedTheme)}</strong>
                  {activeSlot && <span style={{ color: "var(--accent)", fontWeight: 700 }}> · {t.themeOwnStyle} «{activeSlot.name}»</span>}
                  {isDraft && draft && <span style={{ color: "var(--accent)", fontWeight: 700 }}> · {t.themeOwnStyle} «{draft.name}»</span>}
                </p>
              </div>
              <div className="theme-status-modes">
                <button className={`theme-status-mode-btn ${themeMode === "light" ? "active" : ""}`} onClick={() => handleSetMode("light")}><span className="icon icon--sun" /> {t.themeModeLight}</button>
                <button className={`theme-status-mode-btn ${themeMode === "dark" ? "active" : ""}`} onClick={() => handleSetMode("dark")}><span className="icon icon--moon" /> {t.themeModeDark}</button>
                <button className={`theme-status-mode-btn ${themeMode === "system" ? "active" : ""}`} onClick={() => handleSetMode("system")}><span className="icon icon--monitor" /> {t.themeModeSystem}</button>
              </div>
            </div>
            <div className="theme-status-grid">
              <div className="theme-status-pref">
                <div>
                  <span className="theme-status-pref-label">{t.themeLightLabel}:</span>
                  <span className="theme-status-pref-value">{customLight ? customLight.name : shortThemeName(prefLight)}</span>
                </div>
                <span className={`theme-status-tag ${curDark ? "saved" : "active"}`}>{curDark ? t.themeSaved : "✓ " + t.themeActive}</span>
              </div>
              <div className="theme-status-pref">
                <div>
                  <span className="theme-status-pref-label">{t.themeDarkLabel}:</span>
                  <span className="theme-status-pref-value">
                    {customDark ? customDark.name : shortThemeName(useOled ? toOled(prefDark) : prefDark)}
                    {!customDark && useOled && <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-2xs)" }}> (OLED)</span>}
                  </span>
                </div>
                <span className={`theme-status-tag ${curDark ? "active" : "saved"}`}>{curDark ? "✓ " + t.themeActive : t.themeSaved}</span>
              </div>
            </div>
          </div>

          {/* ── Вкладки: Стандартные / Свой выбор ── */}
          <div className="theme-tabs">
            <button className={`theme-tab-btn ${tab === "standard" ? "active" : ""}`} onClick={() => setTab("standard")}><span className="icon icon--palette" /> {t.themeTabStandard}</button>
            <button className={`theme-tab-btn ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}><span className="icon icon--edit" /> {t.themeTabCustom}</button>
          </div>

          {/* ── Вкладка 1: Стандартные (OLED — галочкой) ── */}
          {tab === "standard" && (
            <div className="theme-tab-panel">
              <div className="theme-status-oled">
                <div>
                  <h4 className="theme-status-oled-title"><span className="icon icon--heart" /> {t.themeOledTitle}</h4>
                  <p className="theme-status-oled-desc">{t.themeOledDesc}</p>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={useOled} onChange={(e) => handleOled(e.target.checked)} />
                  <span className="switch-track"></span>
                </label>
              </div>
              <p className="pv-note">{t.themeSwatchNote}</p>
              {FAMILIES.map((f) => (
                <div className="theme-family" key={f.family}>
                  <h4 className="theme-family-label">
                    <span className="theme-family-dot" style={{ background: f.accent }} />
                    {f.label}
                  </h4>
                  <div className="theme-swatches">
                    {([
                      { mode: "light", name: t.themeModeLight, colors: [f.light[0], f.accent, f.light[1]] },
                      { mode: "dark", name: t.themeModeDark, colors: [f.dark[0], f.accent, f.dark[1]] },
                    ] as const).map((m) => {
                      const id = `${m.mode}-${f.family}` as ThemeId;
                      const active = activeBase === id;
                      return (
                        <button
                          key={id}
                          className={`theme-swatch ${active ? "active" : ""}`}
                          style={{ background: m.colors[0], color: m.colors[2] }}
                          onClick={() => handleSwatch(id)}
                        >
                          <span className="theme-swatch-colors">
                            <span style={{ background: m.colors[0] }}></span>
                            <span style={{ background: m.colors[1] }}></span>
                            <span style={{ background: m.colors[2] }}></span>
                          </span>
                          <span className="theme-swatch-name">{m.name}</span>
                          <span className="theme-swatch-check">✓</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Вкладка 2: Свой выбор ── */}
          {tab === "custom" && (
            <div className="theme-tab-panel">
              <p className="pv-note">{t.themeCustomNote}</p>
              <div className="pv-grid">
                <div className="pv-card">
                  <h3>{t.themeAccentLabel}</h3>
                  <div className="designer-colors-grid">
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        className={`color-dot-btn ${draft?.accent === c ? "active" : ""}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => handleAccent(c)}
                      />
                    ))}
                  </div>
                  <div className="slider-header-row">
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-secondary)" }}>{t.themeHueLabel}</span>
                    <span className="hue-value-indicator">{draft?.accent ? hslToHex(hue, 85, 55) : "—"}</span>
                  </div>
                  <div className="rainbow-slider-container">
                    <input
                      type="range" min={0} max={360} value={hue}
                      className="rainbow-hue-slider"
                      onChange={(e) => { const v = parseInt(e.target.value); setHue(v); handleAccent(hslToHex(v, 85, 55)); }}
                    />
                  </div>
                  <div className="code-color-row">
                    <input type="color" className="code-color-picker" value={draft?.accent || "#9444d6"} onChange={(e) => { const hex = e.target.value; handleAccent(hex); setHue(hexToHue(hex)); setAccentHexTxt(hex); }} title={t.themeCode} />
                    <input type="text" className="code-color-input" value={accentHexTxt} onChange={(e) => { const v = e.target.value; setAccentHexTxt(v); applyAccentHex(v); }} onBlur={(e) => commitAccentHex(e.target.value)} placeholder="#9444d6" spellCheck={false} />
                  </div>
                  <div className="designer-actions-row">
                    <button className="reset-accent-btn" onClick={() => setDraft(draft?.bgColor ? { ...draft, accent: null } : null)}>
                      {t.themeResetAccent}
                    </button>
                    <span className="pv-hint">{draft?.accent ? `${t.themeOwnAccent}: ${draft.accent}` : t.themeAccentFromTheme}</span>
                  </div>
                </div>

                <div className="pv-card">
                  <h3>{t.themeBgLabel}</h3>
                  <div className="pv-bg-row">
                    {([["theme", t.themeBgTheme], ["light", t.themeBgLight], ["dark", t.themeBgDark], ["oled", "OLED"]] as const).map(([v, label]) => (
                      <button
                        key={v}
                        className={`pv-bg-btn ${(draft?.bgColor || draft?.accent) && draft?.bgType === v ? "active" : (!draft && v === "theme" ? "active" : "")}`}
                        onClick={() => handleBgMode(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", display: draft?.bgType === "oled" ? "none" : "" }}>
                    {t.themeShadesLabel}:
                  </div>
                  <div className="bg-preset-shades" style={{ display: draft?.bgType === "oled" ? "none" : "" }}>
                    {(draft?.bgType === "light" ? LIGHT_SHADES : DARK_SHADES).map((c) => (
                      <button
                        key={c}
                        className={`bg-shade-btn ${draft?.bgColor === c ? "active" : ""}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => handleBgShade(c)}
                      />
                    ))}
                  </div>
                  <div className="code-color-row">
                    <input type="color" className="code-color-picker" value={draft?.bgColor || "#12131a"} onChange={(e) => handleBgShade(e.target.value)} title={t.themeCode} />
                    <input type="text" className="code-color-input" value={bgHexTxt} onChange={(e) => { const v = e.target.value; setBgHexTxt(v); applyBgHex(v); }} onBlur={(e) => commitBgHex(e.target.value)} placeholder="#12131a" spellCheck={false} />
                  </div>
                  <p className="pv-note">
                    {draft?.bgType === "oled" ? t.themeOledNoShades : t.themeShadesNote}
                  </p>
                </div>
              </div>

              <div className="pv-card">
                <h3>{t.themeMyStyles}</h3>
                <p className="preset-actions-hint">{t.themeSlotsHint}</p>
                <div className="slot-rows">
                  {(["light", "dark"] as const).map((kind) => {
                    const slot = kind === "light" ? customLight : customDark;
                    const isCur = curDark === (kind === "dark");
                    return (
                      <div className="preset-item-row" key={kind}>
                        <div className="preset-item-info">
                          <span className="preset-preview-circle" style={{ background: slot?.bgColor || (kind === "light" ? "#f4f0ec" : "#0f0f15") }}>
                            <span className="preset-preview-dot" style={{ background: slot?.accent || "#4c5699" }}></span>
                          </span>
                          <span className="preset-item-name">
                            {kind === "light" ? <span className="icon icon--sun" /> : <span className="icon icon--moon" />} {t.themeSlotLabel}: {slot ? slot.name : "—"}
                          </span>
                        </div>
                        <div className="preset-item-actions">
                          {slot && (
                            <>
                              <span className={`theme-status-tag ${isCur && activeSlot ? "active" : "saved"}`}>
                                {isCur && activeSlot ? "✓ " + t.themeApplied : t.themeSaved}
                              </span>
                              <button className="preset-action-btn delete" title={t.themeClearSlot} onClick={() => clearSlot(kind)}><span className="icon icon--close" /></button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="preset-actions-hint">{t.themeLibraryHint}</p>
                <div className="presets-list">
                  {presets.length === 0 && <p className="no-presets-text">{t.themeNoStyles}</p>}
                  {presets.map((p) => {
                    const applied = p.slot && ((p.slot === "light" ? customLight : customDark)?.name === p.name);
                    return (
                      <div className="preset-item-row" key={p.id}>
                        <div className="preset-item-info" title={t.themeApply} onClick={() => applyPreset(p)}>
                          <span className="preset-preview-circle" style={{ background: p.bgColor || "#f4f0ec" }}>
                            <span className="preset-preview-dot" style={{ background: p.accent || "#4c5699" }}></span>
                          </span>
                          <span className="preset-item-name">{p.name}</span>
                        </div>
                        <div className="preset-item-actions">
                          <button className={`preset-action-btn apply ${applied ? "active" : ""}`} onClick={() => applyPreset(p)}>
                            {applied ? "✓ " + t.themeApplied : t.themeApply}
                          </button>
                          <button className="preset-action-btn" title={t.themeCode} onClick={() => copyPresetCode(p)}><span className="icon icon--copy" /></button>
                          <button className="preset-action-btn delete" title={t.themeDelete} onClick={() => setPresets(prev => prev.filter(x => x.id !== p.id))}><span className="icon icon--close" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="save-preset-form">
                  <input
                    type="text" className="preset-name-input" value={presetName}
                    placeholder={t.themePresetPlaceholder}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                  <select className="preset-slot-select" value={presetSlotSel} onChange={(e) => setPresetSlotSel(e.target.value as typeof presetSlotSel)} title={t.themePresetSlot}>
                    <option value="auto">{t.themePresetSlotAuto}</option>
                    <option value="light">{t.themePresetSlotLight}</option>
                    <option value="dark">{t.themePresetSlotDark}</option>
                  </select>
                  <button className="save-preset-btn" onClick={savePreset}><span className="icon icon--save" /> {t.themeSave}</button>
                </div>
                <div className="import-preset-form">
                  <div className="import-input-wrap">
                    <input
                      type="text" className="preset-import-input" value={importCode}
                      placeholder={t.themeImportPlaceholder}
                      onChange={(e) => setImportCode(e.target.value)}
                    />
                    <button className="import-preset-btn" onClick={importPreset}>{t.themeImport}</button>
                  </div>
                  {flash && <span className="import-error-msg" style={{ color: flash.ok ? "var(--success)" : "var(--danger)" }}>{flash.text}</span>}
                </div>
              </div>
            </div>
          )}

          {/* ── D. Масштаб интерфейса и размер шрифта ── */}
          <div className="pv-grid" style={{ marginTop: 12 }}>
            <div className="scale-section">
              <div className="scale-header">
                <div>
                  <h3 className="scale-title"><span className="icon icon--maximize" /> {t.zoomUi}</h3>
                  <p className="scale-desc">{t.themeScaleDesc}</p>
                </div>
                <span className="scale-value">{zoom}%</span>
              </div>
              <div className="scale-slider-wrap">
                <input type="range" min={70} max={200} step={5} value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))} />
              </div>
              <div className="scale-labels"><span className="min">70%</span><span className="mid">100%</span><span className="max">200%</span></div>
              <div className="scale-presets">
                {ZOOM_PRESETS.map((v) => (
                  <button key={v} className={`scale-preset-btn ${zoom === v ? "active" : ""}`} onClick={() => setZoom(v)}>{v}%</button>
                ))}
              </div>
            </div>
            <div className="scale-section">
              <div className="scale-header">
                <div>
                  <h3 className="scale-title"><span className="icon icon--type" /> {t.fontScaleLabel}</h3>
                  <p className="scale-desc">{t.themeFontScaleDesc}</p>
                </div>
                <span className="scale-value">{fontScale}%</span>
              </div>
              <div className="scale-slider-wrap">
                <input type="range" min={80} max={140} step={5} value={fontScale} onChange={(e) => setFontScale(parseInt(e.target.value))} />
              </div>
              <div className="scale-labels"><span className="min">80%</span><span className="mid">100%</span><span className="max">140%</span></div>
              <div className="scale-presets">
                {FONT_PRESETS.map((v) => (
                  <button key={v} className={`scale-preset-btn ${fontScale === v ? "active" : ""}`} onClick={() => setFontScale(v)}>{v}%</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
