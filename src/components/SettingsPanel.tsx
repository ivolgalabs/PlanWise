import { useState } from "react";
import { useStore } from "../store";
import { THEME_FAMILIES, argbToHex, hexToArgb } from "../theme";
import type { ThemeMode } from "../store";
import { api } from "../api";
import { Icon, type IconName } from "./Icon";
import "./SettingsPanel.css";

interface Props {
  onClose: () => void;
  /** Перезагрузить категории после правок (App обновляет store.colorSets). */
  onSetsChanged: () => void;
}

const SCALE_PRESETS = [0.7, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];
const FONT_PRESETS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6];

/** Черновик категории для редактирования (id "" = ещё не создана). */
interface SetDraft {
  id: string;
  name: string;
  color: number;
}

/**
 * Полноценное окно настроек: Оформление (тема свотчами + режим +
 * OLED + масштаб ползунком), Неделя и Категории (цвет-сеты).
 */
export function SettingsPanel({ onClose, onSetsChanged }: Props) {
  const {
    mondayFirst,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    uiScale,
    fontScale,
    rolloverEnabled,
    colorSets,
    toggleMondayFirst,
    setThemeMode,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setUseOledForDarkMode,
    setUiScale,
    setFontScale,
    setRolloverEnabled,
  } = useStore();

  // Черновики категорий для редактирования (служебный cs-none скрыт).
  const [drafts, setDrafts] = useState<SetDraft[]>(() =>
    colorSets
      .filter((s) => s.id !== "cs-none")
      .map((s) => ({ id: s.id, name: s.name, color: s.color })),
  );

  const patchDraft = (id: string, patch: Partial<SetDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const addDraft = () =>
    setDrafts((ds) => [
      ...ds,
      { id: "", name: "Новая категория", color: hexToArgb("#7eb8c4") },
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
      ds.map((x) => (x.id === d.id ? { ...x, id: saved.id } : x)),
    );
    onSetsChanged();
  };

  const removeDraft = async (d: SetDraft) => {
    if (d.id) {
      await api.deleteColorSet(d.id);
      onSetsChanged();
    }
    setDrafts((ds) => ds.filter((x) => x.id !== d.id));
  };

  const modes: { mode: ThemeMode; icon: IconName; label: string }[] = [
    { mode: "light", icon: "sun", label: "Светлая" },
    { mode: "dark", icon: "moon", label: "Тёмная" },
    { mode: "system", icon: "monitor", label: "Системная" },
  ];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* Шапка */}
        <div className="settings-header">
          <h2
            className="settings-title"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
          >
            <Icon name="gear" size={18} /> Настройки
          </h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="settings-body">
          {/* ── Масштаб ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">🔍 Масштаб интерфейса</h3>
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
                <h3 className="section-title">🔤 Размер шрифта</h3>
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

          {/* ── Режим темы ── */}
          <section className="settings-section">
            <h3 className="section-title">🎨 Режим оформления</h3>
            <p className="section-hint">Мгновенное переключение между светлой/тёмной/системной</p>
            <div className="mode-row">
              {modes.map((m) => (
                <button
                  key={m.mode}
                  onClick={() => setThemeMode(m.mode)}
                  className={`mode-btn ${themeMode === m.mode ? "active" : ""}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "var(--sp-3)",
                  }}
                >
                  <Icon name={m.icon} size={14} /> {m.label}
                </button>
              ))}
            </div>

            {/* OLED toggle */}
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={useOledForDarkMode}
                onChange={(e) => setUseOledForDarkMode(e.target.checked)}
              />
              <span>🖤 Использовать OLED (True Black) для тёмного режима</span>
            </label>

            {/* Текущие предпочтения */}
            <div className="pref-row">
              <div className="pref-card">
                <span className="pref-label">Светлая</span>
                <strong className="pref-value">{preferredLightTheme}</strong>
                <span className={`pref-tag ${themeMode === "light" ? "on" : ""}`}>
                  {themeMode === "light" ? "✓ активна" : "сохранена"}
                </span>
              </div>
              <div className="pref-card">
                <span className="pref-label">Тёмная{useOledForDarkMode ? " (OLED)" : ""}</span>
                <strong className="pref-value">{preferredDarkTheme}</strong>
                <span className={`pref-tag ${themeMode === "dark" ? "on" : ""}`}>
                  {themeMode === "dark" ? "✓ активна" : "сохранена"}
                </span>
              </div>
            </div>
          </section>

          {/* ── Выбор темы (свотчи по семьям) ── */}
          <section className="settings-section">
            <h3 className="section-title">Палитра</h3>
            <p className="section-hint">Нажмите на свотч — тема применится мгновенно</p>
            <div className="theme-families">
              {THEME_FAMILIES.map((fam) => (
                <div key={fam.family} className="family-block">
                  <div className="family-head">
                    <span className="family-dot" style={{ background: fam.accent }} />
                    <span className="family-name">{fam.label}</span>
                  </div>
                  <div className="swatch-row">
                    {fam.modes.map((mode) => {
                      const isLight = mode.id.startsWith("light-");
                      const isActive = isLight
                        ? preferredLightTheme === mode.id
                        : preferredDarkTheme === mode.id;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => {
                            if (isLight) {
                              setPreferredLightTheme(mode.id);
                              setThemeMode("light");
                            } else {
                              setPreferredDarkTheme(mode.id);
                              setThemeMode("dark");
                            }
                          }}
                          className={`theme-swatch ${isActive ? "active" : ""}`}
                          style={{
                            background: mode.bg,
                            borderColor: isActive ? fam.accent : "var(--border-color)",
                          }}
                          title={`${fam.label} · ${mode.name}`}
                        >
                          <div className="swatch-colors">
                            <span style={{ background: mode.bg }} />
                            <span style={{ background: fam.accent }} />
                            <span style={{ background: mode.text }} />
                          </div>
                          <span className="swatch-name" style={{ color: mode.text }}>
                            {mode.name}
                          </span>
                          {isActive && (
                            <span className="swatch-check" style={{ color: fam.accent }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
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
          </section>

          {/* ── Задачи ── */}
          <section className="settings-section">
            <h3 className="section-title">Задачи</h3>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={rolloverEnabled}
                onChange={(e) => setRolloverEnabled(e.target.checked)}
              />
              <span>Авто-перенос невыполненных задач на сегодня</span>
            </label>
          </section>

          {/* ── Категории (цвет-сеты) ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">🎨 Категории</h3>
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
                <div key={d.id || "__new__"} className="set-row">
                  <input
                    type="color"
                    value={argbToHex(d.color)}
                    onChange={(e) => patchDraft(d.id, { color: hexToArgb(e.target.value) })}
                    className="set-color"
                    title="Цвет категории"
                  />
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => patchDraft(d.id, { name: e.target.value })}
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
        </div>
      </div>
    </div>
  );
}
