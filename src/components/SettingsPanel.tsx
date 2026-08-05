import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import {
  COLORS, THEME_FAMILIES, argbToHex, hexToArgb,
  ACCENTS, LIGHT_SHADES, DARK_SHADES, hslToHex, hexToHue, autoSlotFor,
  applyCustomSlot,
} from "../theme";
import type { CustomSlot, ThemePreset } from "../theme";
import type { ThemeMode, VisibilityState } from "../store";
import { DEFAULT_VISIBILITY } from "../store";
import { api, isTauri } from "../api";
import { Icon, type IconName } from "./Icon";
import "./SettingsPanel.css";

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
  const theme = themeEnc.replace(/_/g, "-");
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

interface Props {
  onClose: () => void;
  /** Перезагрузить категории после правок (App обновляет store.colorSets). */
  onSetsChanged: () => void;
  /** Перезагрузить задачи после импорта (App обновляет store.tasks). */
  onTasksChanged: () => void;
  /** Сброс настроек интерфейса: ширина правой панели живёт в App (не в store). */
  onResetUI?: () => void;
}

const SCALE_PRESETS = [0.7, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];
const FONT_PRESETS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6];

/** Черновик категории для редактирования (id "" = ещё не создана).
 *  clientKey — уникальный ключ строки (crypto.randomUUID): у несохранённых
 *  черновиков id совпадает (""), поэтому React-key и патчи идут по clientKey. */
interface SetDraft {
  id: string;
  clientKey: string;
  name: string;
  color: number;
}

/**
 * Полноценное окно настроек: Оформление (тема свотчами + режим +
 * OLED + масштаб ползунком), Неделя и Категории (цвет-сеты).
 */
export function SettingsPanel({ onClose, onSetsChanged, onTasksChanged, onResetUI }: Props) {
  const {
    mondayFirst,
    weekVertical,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    customLight,
    customDark,
    presets,
    uiScale,
    fontScale,
    archiveEnabled,
    colorSets,
    visibility,
    panelGap,
    toggleMondayFirst,
    setThemeMode,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setUseOledForDarkMode,
    setCustomLight,
    setCustomDark,
    setPresets,
    setWeekVertical,
    setUiScale,
    setFontScale,
    setArchiveEnabled,
    setVisibility,
    setPanelGap,
  } = useStore();

  // Черновики категорий для редактирования (служебный cs-none скрыт).
  const [drafts, setDrafts] = useState<SetDraft[]>(() =>
    colorSets
      .filter((s) => s.id !== "cs-none")
      .map((s) => ({ id: s.id, clientKey: crypto.randomUUID(), name: s.name, color: s.color })),
  );

  // colorSets грузятся асинхронно — если панель открылась до загрузки,
  // черновики остались пустыми. Дозаполняем их, когда данные пришли
  // (пользователь при этом ещё ничего не создавал).
  useEffect(() => {
    if (drafts.length === 0 && colorSets.some((s) => s.id !== "cs-none")) {
      setDrafts(
        colorSets
          .filter((s) => s.id !== "cs-none")
          .map((s) => ({ id: s.id, clientKey: crypto.randomUUID(), name: s.name, color: s.color })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorSets]);

  const patchDraft = (clientKey: string, patch: Partial<SetDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.clientKey === clientKey ? { ...d, ...patch } : d)));

  const addDraft = () =>
    setDrafts((ds) => [
      ...ds,
      { id: "", clientKey: crypto.randomUUID(), name: "Новая категория", color: hexToArgb("#7eb8c4") },
    ]);

  const saveDraft = async (d: SetDraft) => {
    const saved = await api.upsertColorSet({
      id: d.id || undefined,
      name: d.name.trim() || "Без названия",
      color: d.color,
    });
    // Новая категория получает id от Rust — обновляем черновик, чтобы
    // повторное сохранение не создавало дубль.
    setDrafts((ds) =>
      ds.map((x) => (x.clientKey === d.clientKey ? { ...x, id: saved.id } : x)),
    );
    onSetsChanged();
  };

  const removeDraft = async (d: SetDraft) => {
    if (d.id) {
      await api.deleteColorSet(d.id);
      onSetsChanged();
    }
    setDrafts((ds) => ds.filter((x) => x.clientKey !== d.clientKey));
  };

  // ── Экспорт/импорт данных (JSON-бэкап) ──
  const [dataMsg, setDataMsg] = useState("");
  const [dataError, setDataError] = useState(false);
  const onExport = async () => {
    // В браузере диалог сохранения недоступен — только в Tauri-приложении.
    if (!isTauri()) {
      setDataError(false);
      setDataMsg("Доступно в приложении");
      return;
    }
    const d = new Date();
    const name = `daily-planner-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    let path: string | null;
    try {
      path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
    } catch (e) { setDataError(true); setDataMsg(String(e)); return; }
    if (!path) return;
    try {
      await invoke("export_to", { path });
      setDataError(false); setDataMsg("Экспортировано ✓");
    } catch (e) { setDataError(true); setDataMsg(String(e)); }
  };
  const onImport = async () => {
    if (!isTauri()) {
      setDataError(false);
      setDataMsg("Доступно в приложении");
      return;
    }
    let path: string | string[] | null;
    try {
      path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    } catch (e) { setDataError(true); setDataMsg(String(e)); return; }
    if (!path || Array.isArray(path)) return;
    if (!window.confirm("Данные будут ЗАМЕНЕНЫ данными из файла. Продолжить?")) return;
    try {
      const n = await invoke<number>("import_from", { path });
      setDataError(false); setDataMsg(`Импортировано задач: ${n}`);
      onSetsChanged();
      onTasksChanged();
    } catch (e) { setDataError(true); setDataMsg(String(e)); }
  };

  // ── Оформление: «Свой выбор» (конструктор, как в TensorMedia) ──
  // Текущий тёмный режим (для авто-фона и выбора активного слота).
  const systemIsDark =
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const curDark =
    themeMode === "dark" || (themeMode === "system" && systemIsDark);
  // Разрешённая тема сейчас (дубль логики resolveActiveTheme из App).
  const resolvedTheme =
    themeMode === "light"
      ? preferredLightTheme
      : themeMode === "dark"
        ? useOledForDarkMode
          ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
          : preferredDarkTheme
        : systemIsDark
          ? useOledForDarkMode
            ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
            : preferredDarkTheme
          : preferredLightTheme;
  // Активный свотч: тема применена сейчас (без OLED-замены показываем базу).
  const activeBase = resolvedTheme.replace(/^oled-/, "dark-");

  // Черновик «Своего выбора»: применяется вживую; при закрытии сбрасывается.
  const [draft, setDraft] = useState<CustomSlot | null>(() => {
    const cur = curDark ? customDark : customLight;
    return cur ? { ...cur } : null;
  });
  const [hue, setHue] = useState(() => (draft?.accent ? hexToHue(draft.accent) : 0));
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [presetName, setPresetName] = useState("");
  const [presetSlotSel, setPresetSlotSel] = useState<"auto" | "light" | "dark">("auto");
  const [importCode, setImportCode] = useState("");
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const msg = (text: string, ok = true) => {
    setFlash({ text, ok });
    window.setTimeout(() => setFlash(null), 4000);
  };

  // Сброс настроек интерфейса: видимость элементов, зазор панели, ориентация
  // недели, масштабы. Ширина панели (App) сбрасывается через onResetUI.
  const resetInterface = () => {
    (Object.keys(DEFAULT_VISIBILITY) as (keyof VisibilityState)[]).forEach((k) =>
      setVisibility(k, DEFAULT_VISIBILITY[k]),
    );
    setPanelGap(20);
    setWeekVertical(true);
    setUiScale(1);
    setFontScale(1);
    if (!mondayFirst) toggleMondayFirst();
    onResetUI?.();
    msg("Настройки интерфейса сброшены к умолчаниям");
  };

  // Применяем черновик (или активный слот) поверх темы вживую.
  useEffect(() => {
    applyCustomSlot(document.documentElement, draft ?? (curDark ? customDark : customLight), curDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, customLight, customDark, themeMode]);

  // Закрытие: сбрасываем черновик (возвращаем активный слот из хранилища).
  const close = () => {
    applyCustomSlot(document.documentElement, curDark ? customDark : customLight, curDark);
    onClose();
  };

  const handleSetMode = (m: ThemeMode) => {
    setThemeMode(m);
    const isD = m === "dark" || (m === "system" && systemIsDark);
    const cur = isD ? customDark : customLight;
    setDraft(cur ? { ...cur } : null);
  };

  // Свотч стандартной темы: применяет и очищает слот своего стиля.
  const handleSwatch = (id: string) => {
    if (id.startsWith("light-")) {
      setPreferredLightTheme(id);
      setThemeMode("light");
      setCustomLight(null);
    } else {
      setPreferredDarkTheme(id);
      setThemeMode("dark");
      setCustomDark(null);
    }
    setDraft(null);
  };

  // Конструктор: акцент / фон. (patchDraft — у черновиков категорий выше.)
  const patchSlot = (patch: Partial<CustomSlot>) => {
    setDraft({
      name: draft?.name || "Мой стиль",
      accent: draft?.accent ?? null,
      bgType: draft?.bgType ?? "auto",
      bgColor: draft?.bgColor ?? null,
      ...patch,
    });
  };
  const handleAccent = (accent: string) => patchSlot({ accent });
  const handleBgMode = (bgMode: "theme" | "light" | "dark" | "oled") => {
    if (bgMode === "theme") {
      setDraft(draft?.accent ? { name: draft.name, accent: draft.accent, bgType: "auto", bgColor: null } : null);
    } else {
      patchSlot({ bgType: bgMode });
    }
  };
  const handleBgShade = (c: string) => {
    const bgType = LIGHT_SHADES.includes(c) ? "light" : c === "#000000" ? "oled" : "dark";
    patchSlot({ bgType, bgColor: c });
  };

  // ── Библиотека «Мои стили» ──
  const savePreset = () => {
    let name = presetName.trim();
    if (!name) {
      let n = 1;
      while (presets.some((p) => p.name === `Стиль #${n}`)) n++;
      name = `Стиль #${n}`;
    }
    if (presets.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      msg(`Стиль «${name}» уже есть`, false);
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
    setPresets([...presets, preset]);
    setPresetName("");
    msg(slot === "light" ? "Сохранено в слот ☀️" : "Сохранено в слот 🌙");
  };

  const applyPreset = (p: ThemePreset) => {
    if (p.theme.startsWith("light-")) setPreferredLightTheme(p.theme);
    else if (p.theme.startsWith("oled-")) {
      setPreferredDarkTheme(p.theme.replace("oled-", "dark-"));
      setUseOledForDarkMode(true);
    } else setPreferredDarkTheme(p.theme);
    const slot = p.slot || autoSlotFor({ bgColor: p.bgColor, bgMode: p.bgMode, theme: p.theme });
    const slotData: CustomSlot = { name: p.name, accent: p.accent, bgType: p.bgMode === "theme" ? "auto" : p.bgMode, bgColor: p.bgColor };
    if (slot === "light") setCustomLight(slotData);
    else setCustomDark(slotData);
    setThemeMode(slot === "light" ? "light" : "dark");
    setDraft(null);
    msg(`Применён стиль «${p.name}»`);
  };

  const copyPresetCode = (p: ThemePreset) => {
    const code = encodePresetCode(p);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).catch(() => {});
    setImportCode(code);
    msg(`Код скопирован: ${code}`);
  };

  const importPreset = () => {
    const p = decodePresetCode(importCode.trim());
    if (!p) { msg("Неверный формат кода", false); return; }
    setPresets([
      ...presets,
      { ...p, id: Math.random().toString(36).slice(2, 9), name: `Импорт ${p.theme}` },
    ]);
    setImportCode("");
    msg("Стиль импортирован");
  };

  const clearSlot = (kind: "light" | "dark") => {
    if (kind === "light") setCustomLight(null);
    else setCustomDark(null);
    if (curDark === (kind === "dark")) setDraft(null);
  };

  const modes: { mode: ThemeMode; icon: IconName; label: string }[] = [
    { mode: "light", icon: "sun", label: "Светлая" },
    { mode: "dark", icon: "moon", label: "Тёмная" },
    { mode: "system", icon: "monitor", label: "Системная" },
  ];

  return (
    <div className="settings-overlay" onClick={close}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* Шапка */}
        <div className="settings-header">
          <h2
            className="settings-title"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
          >
            <Icon name="gear" size={18} /> Настройки
          </h2>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="settings-body">
          {/* ── Масштаб ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3
                  className="section-title"
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                >
                  <Icon name="zoom" size={14} /> Масштаб интерфейса
                </h3>
                <p className="section-hint">От 70% до 200% — применяется ко всем элементам</p>
              </div>
              <span className="scale-badge">{Math.round(uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={2.0}
              step={0.05}
              value={uiScale}
              onChange={(e) => setUiScale(parseFloat(e.target.value))}
              className="scale-slider"
            />
            <div className="scale-marks">
              <span>70%</span>
              <span>100%</span>
              <span>150%</span>
              <span>200%</span>
            </div>
            <div className="scale-presets">
              {SCALE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setUiScale(s)}
                  className={`preset-btn ${Math.abs(uiScale - s) < 0.01 ? "active" : ""}`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </section>

          {/* ── Размер шрифта ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Размер шрифта</h3>
                <p className="section-hint">Меняет только текст, без масштабирования всего интерфейса</p>
              </div>
              <span className="scale-badge">{Math.round(fontScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.8}
              max={1.6}
              step={0.05}
              value={fontScale}
              onChange={(e) => setFontScale(parseFloat(e.target.value))}
              className="scale-slider"
            />
            <div className="scale-marks">
              <span>80%</span>
              <span>100%</span>
              <span>130%</span>
              <span>160%</span>
            </div>
            <div className="scale-presets">
              {FONT_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setFontScale(s)}
                  className={`preset-btn ${Math.abs(fontScale - s) < 0.01 ? "active" : ""}`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </section>

          {/* ── Оформление: статус + вкладки (стандартные / свой выбор) ── */}
          <section className="settings-section">
            <div className="theme-status">
              <div className="theme-status-head">
                <div>
                  <h3 className="theme-status-title">Оформление</h3>
                  <p className="theme-status-subtitle">
                    Активная тема: <strong>{resolvedTheme}</strong>
                  </p>
                </div>
                <div className="theme-status-modes">
                  {modes.map((m) => (
                    <button
                      key={m.mode}
                      className={`theme-status-mode-btn ${themeMode === m.mode ? "active" : ""}`}
                      onClick={() => handleSetMode(m.mode)}
                    >
                      <Icon name={m.icon} size={13} /> {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="theme-status-grid">
                <div className="theme-status-pref">
                  <div>
                    <span className="theme-status-pref-label">Светлая:</span>
                    <span className="theme-status-pref-value">
                      {customLight ? customLight.name : preferredLightTheme}
                    </span>
                  </div>
                  <span className={`theme-status-tag ${curDark ? "saved" : "active"}`}>
                    {curDark ? "сохранена" : "✓ активна"}
                  </span>
                </div>
                <div className="theme-status-pref">
                  <div>
                    <span className="theme-status-pref-label">Тёмная:</span>
                    <span className="theme-status-pref-value">
                      {customDark ? customDark.name : useOledForDarkMode ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-") : preferredDarkTheme}
                      {!customDark && useOledForDarkMode && <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-2xs)" }}> (OLED)</span>}
                    </span>
                  </div>
                  <span className={`theme-status-tag ${curDark ? "active" : "saved"}`}>
                    {curDark ? "✓ активна" : "сохранена"}
                  </span>
                </div>
              </div>
            </div>

            {/* Вкладки: Стандартные / Свой выбор */}
            <div className="theme-tabs">
              <button className={`theme-tab-btn ${tab === "standard" ? "active" : ""}`} onClick={() => setTab("standard")}>
                Стандартные
              </button>
              <button className={`theme-tab-btn ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}>
                Свой выбор
              </button>
            </div>

            {/* ── Вкладка 1: Стандартные (OLED — галочкой) ── */}
            {tab === "standard" && (
              <div className="theme-tab-panel">
                <div className="theme-status-oled">
                  <div>
                    <h4 className="theme-status-oled-title">OLED (True Black)</h4>
                    <p className="theme-status-oled-desc">
                      Чистый чёрный фон для тёмного режима
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={useOledForDarkMode}
                      onChange={(e) => setUseOledForDarkMode(e.target.checked)}
                    />
                    <span className="switch-track"></span>
                  </label>
                </div>
                {THEME_FAMILIES.map((f) => (
                  <div className="theme-family" key={f.family}>
                    <h4 className="theme-family-label">
                      <span className="theme-family-dot" style={{ background: f.accent }} />
                      {f.label}
                    </h4>
                    <div className="theme-swatches">
                      {f.modes
                        .filter((m) => !m.id.startsWith("oled-"))
                        .map((m) => {
                          const isLight = m.id.startsWith("light-");
                          const active = isLight
                            ? preferredLightTheme === m.id
                            : activeBase === m.id;
                          return (
                            <button
                              key={m.id}
                              className={`theme-swatch ${active ? "active" : ""}`}
                              style={{ background: m.bg, color: m.text }}
                              onClick={() => handleSwatch(m.id)}
                              title={`${f.label} · ${m.name}`}
                            >
                              <span className="theme-swatch-colors">
                                <span style={{ background: m.bg }} />
                                <span style={{ background: f.accent }} />
                                <span style={{ background: m.text }} />
                              </span>
                              <span className="theme-swatch-name">{m.name}</span>
                              {active && <span className="theme-swatch-check">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Вкладка 2: Свой выбор (конструктор) ── */}
            {tab === "custom" && (
              <div className="theme-tab-panel">
                <p className="pv-note">
                  Свой акцент и фон — поверх выбранной темы. Применяется сразу;
                  сохраните в «Мои стили», чтобы не потерять.
                </p>
                <div className="pv-grid">
                  <div className="pv-card">
                    <h3>Акцент</h3>
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
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-secondary)" }}>Оттенок</span>
                      <span className="hue-value-indicator">{draft?.accent ? hslToHex(hue, 85, 55) : "—"}</span>
                    </div>
                    <div className="rainbow-slider-container">
                      <input
                        type="range" min={0} max={360} value={hue}
                        className="rainbow-hue-slider"
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          setHue(v);
                          handleAccent(hslToHex(v, 85, 55));
                        }}
                      />
                    </div>
                    <div className="designer-actions-row">
                      <button
                        className="reset-accent-btn"
                        onClick={() => setDraft(draft?.bgColor ? { ...draft, accent: null } : null)}
                      >
                        Сбросить акцент
                      </button>
                      <span className="pv-hint">
                        {draft?.accent ? `Свой акцент: ${draft.accent}` : "Акцент — из темы"}
                      </span>
                    </div>
                  </div>

                  <div className="pv-card">
                    <h3>Фон</h3>
                    <div className="pv-bg-row">
                      {([["theme", "Из темы"], ["light", "Светлый"], ["dark", "Тёмный"], ["oled", "OLED"]] as const).map(([v, label]) => (
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
                      Оттенки:
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
                    <p className="pv-note">
                      {draft?.bgType === "oled" ? "OLED — чистый чёрный, без оттенков." : "Выберите оттенок фона."}
                    </p>
                  </div>
                </div>

                <div className="pv-card">
                  <h3>Мои стили</h3>
                  <p className="preset-actions-hint">Слоты ☀️/🌙 заполняются при «Применить» из библиотеки</p>
                  <div className="slot-rows">
                    {(["light", "dark"] as const).map((kind) => {
                      const slot = kind === "light" ? customLight : customDark;
                      const isCur = curDark === (kind === "dark");
                      return (
                        <div className="preset-item-row" key={kind}>
                          <div className="preset-item-info">
                            <span
                              className="preset-preview-circle"
                              style={{ background: slot?.bgColor || (kind === "light" ? "#f4f0ec" : "#0f0f15") }}
                            >
                              <span className="preset-preview-dot" style={{ background: slot?.accent || "#4c5699" }} />
                            </span>
                            <span className="preset-item-name">
                              {kind === "light" ? "☀️ " : "🌙 "}Слот: {slot ? slot.name : "—"}
                            </span>
                          </div>
                          <div className="preset-item-actions">
                            {slot && (
                              <>
                                <span className={`theme-status-tag ${isCur && slot ? "active" : "saved"}`}>
                                  {isCur && slot ? "✓ применён" : "сохранён"}
                                </span>
                                <button
                                  className="preset-action-btn delete"
                                  title="Очистить слот"
                                  onClick={() => clearSlot(kind)}
                                >
                                  <Icon name="close" size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="preset-actions-hint">Библиотека — сохранить, применить, скопировать код</p>
                  <div className="presets-list">
                    {presets.length === 0 && <p className="no-presets-text">Своих стилей пока нет.</p>}
                    {presets.map((p) => {
                      const applied = p.slot && ((p.slot === "light" ? customLight : customDark)?.name === p.name);
                      return (
                        <div className="preset-item-row" key={p.id}>
                          <div className="preset-item-info" title="Применить" onClick={() => applyPreset(p)}>
                            <span className="preset-preview-circle" style={{ background: p.bgColor || "#f4f0ec" }}>
                              <span className="preset-preview-dot" style={{ background: p.accent || "#4c5699" }} />
                            </span>
                            <span className="preset-item-name">{p.name}</span>
                          </div>
                          <div className="preset-item-actions">
                            <button className={`preset-action-btn apply ${applied ? "active" : ""}`} onClick={() => applyPreset(p)}>
                              {applied ? "✓ применён" : "Применить"}
                            </button>
                            <button className="preset-action-btn" title="Скопировать TMT-код" onClick={() => copyPresetCode(p)}>
                              <Icon name="copy" size={12} />
                            </button>
                            <button
                              className="preset-action-btn delete"
                              title="Удалить"
                              onClick={() => setPresets(presets.filter((x) => x.id !== p.id))}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="save-preset-form">
                    <input
                      type="text"
                      className="preset-name-input"
                      value={presetName}
                      placeholder="Имя стиля"
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <select
                      className="preset-slot-select"
                      value={presetSlotSel}
                      onChange={(e) => setPresetSlotSel(e.target.value as typeof presetSlotSel)}
                      title="Слот"
                    >
                      <option value="auto">Авто</option>
                      <option value="light">☀️ Светлый</option>
                      <option value="dark">🌙 Тёмный</option>
                    </select>
                    <button className="save-preset-btn" onClick={savePreset}>
                      Сохранить
                    </button>
                  </div>
                  <div className="import-preset-form">
                    <div className="import-input-wrap">
                      <input
                        type="text"
                        className="preset-import-input"
                        value={importCode}
                        placeholder="TMT-код для импорта"
                        onChange={(e) => setImportCode(e.target.value)}
                      />
                      <button className="import-preset-btn" onClick={importPreset}>
                        Импорт
                      </button>
                    </div>
                    {flash && (
                      <span className="import-error-msg" style={{ color: flash.ok ? "var(--success)" : "var(--danger)" }}>
                        {flash.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── Неделя ── */}
          <section className="settings-section">
            <h3 className="section-title">Неделя</h3>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={mondayFirst}
                onChange={toggleMondayFirst}
              />
              <span>Начинается с понедельника</span>
            </label>
            <p className="section-hint setting-desktop-only" style={{ margin: "var(--sp-2) 0 var(--sp-1)" }}>
              Открывать неделю по умолчанию:
            </p>
            {/* На узких/тач-экранах неделя всегда списком (narrow-режим),
                поэтому выбор «Списком/Сеткой» скрывается (класс
                week-layout-setting + media-запрос). */}
            <div className="week-layout-setting">
              <div className="theme-status-modes">
                <button
                  className={`theme-status-mode-btn ${weekVertical ? "active" : ""}`}
                  onClick={() => setWeekVertical(true)}
                >
                  Списком
                </button>
                <button
                  className={`theme-status-mode-btn ${!weekVertical ? "active" : ""}`}
                  onClick={() => setWeekVertical(false)}
                >
                  Сеткой
                </button>
              </div>
            </div>
          </section>

          {/* ── Задачи ── */}
          <section className="settings-section">
            <h3 className="section-title">Задачи</h3>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={archiveEnabled}
                onChange={(e) => setArchiveEnabled(e.target.checked)}
              />
              <span>Авто-архив просроченных задач</span>
            </label>
          </section>

          {/* ── Интерфейс ── */}
          <section className="settings-section">
            <h3 className="section-title">Интерфейс</h3>
            <p className="section-hint">Скрытые элементы можно вернуть здесь же</p>
            {/* Пункты, которых нет на мобильном (кнопка даты скрыта, правая
                панель не показывается) — помечаем setting-desktop-only:
                на тач-экранах они скрыты и появляются в десктопном виде. */}
            {([
              ["navArrows", "Стрелки навигации ‹ ›"],
              ["search", "Кнопка поиска"],
              ["datePicker", "Кнопка даты (заголовок-дата остаётся)"],
              ["miniCalendar", "Мини-календарь справа"],
              ["taskTime", "Время задач"],
              ["subtasks", "Подзадачи"],
              ["notes", "Заметки"],
              ["someday", "«Когда-нибудь»"],
              ["taskActions", "Кнопки «цвет» и «удалить» в задачах"],
              ["archiveBanner", "Баннер «Архивировано задач»"],
            ] as [keyof VisibilityState, string][]).map(([k, label]) => (
              <label
                key={k}
                className={`oled-toggle ${
                  k === "datePicker" || k === "miniCalendar" ? "setting-desktop-only" : ""
                }`}
              >
                <input type="checkbox" checked={visibility[k]} onChange={(e) => setVisibility(k, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
            {/* Расстояние между календарём и «Когда-нибудь» — сохраняется
                между запусками; 0 = секции вплотную. На мобильном правой
                панели нет — блок скрыт (setting-desktop-only). */}
            <div className="setting-desktop-only">
              <div className="section-head" style={{ marginTop: "var(--sp-3)" }}>
                <div>
                  <h3 className="section-title">Панель справа</h3>
                  <p className="section-hint">Расстояние между календарём и «Когда-нибудь»</p>
                </div>
                <span className="scale-badge">{panelGap}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                step={2}
                value={panelGap}
                onChange={(e) => setPanelGap(parseInt(e.target.value, 10))}
                className="scale-slider"
              />
            </div>
            <button className="preset-btn danger" onClick={resetInterface} style={{ marginTop: "var(--sp-3)" }}>
              Сбросить настройки интерфейса
            </button>
          </section>

          {/* ── Категории (цвет-сеты) ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3
                  className="section-title"
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                >
                  <Icon name="palette" size={14} /> Категории
                </h3>
                <p className="section-hint">Свои названия и цвета для задач; применяются в меню цвета, календаре и поиске</p>
              </div>
              <button
                className="preset-btn"
                onClick={addDraft}
                style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
              >
                <Icon name="plus" size={14} /> Добавить
              </button>
            </div>
            <div className="set-list">
              {drafts.map((d) => (
                <div key={d.clientKey} className="set-row">
                  <input
                    type="color"
                    value={argbToHex(d.color)}
                    onChange={(e) => patchDraft(d.clientKey, { color: hexToArgb(e.target.value) })}
                    className="set-color"
                    title="Цвет категории"
                  />
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => patchDraft(d.clientKey, { name: e.target.value })}
                    placeholder="Название категории"
                    className="set-name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveDraft(d);
                    }}
                  />
                  <button
                    className="preset-btn"
                    onClick={() => saveDraft(d)}
                    title="Сохранить"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="save" size={14} />
                  </button>
                  <button
                    className="preset-btn danger"
                    onClick={() => removeDraft(d)}
                    title="Удалить категорию"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              {drafts.length === 0 && (
                <p className="section-hint">Категорий пока нет — добавьте первую.</p>
              )}
            </div>
          </section>

          {/* ── Данные ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Данные</h3>
                <p className="section-hint">Экспорт — полный бэкап; импорт заменяет текущие данные</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button className="preset-btn" onClick={onExport} title="Сохранить бэкап в файл">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="download" size={14} /> Экспорт…</span>
              </button>
              <button className="preset-btn" onClick={onImport} title="Загрузить данные из файла">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="upload" size={14} /> Импорт…</span>
              </button>
              {dataMsg && <span style={{ fontSize: "var(--fs-2xs)", color: dataError ? "var(--danger, #c0392b)" : COLORS.muted }}>{dataMsg}</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
