import { useStore } from "../store";
import { THEME_FAMILIES } from "../theme";
import type { ThemeMode } from "../store";
import "./SettingsPanel.css";

interface Props {
  onClose: () => void;
}

const SCALE_PRESETS = [0.7, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];

/**
 * Полноценное окно настроек: Оформление (тема свотчами + режим +
 * OLED + масштаб ползунком) и Неделя.
 */
export function SettingsPanel({ onClose }: Props) {
  const {
    mondayFirst,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    uiScale,
    toggleMondayFirst,
    setThemeMode,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setUseOledForDarkMode,
    setUiScale,
  } = useStore();

  const modes: { mode: ThemeMode; label: string }[] = [
    { mode: "light", label: "☀️ Светлая" },
    { mode: "dark", label: "🌙 Тёмная" },
    { mode: "system", label: "🖥️ Системная" },
  ];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* Шапка */}
        <div className="settings-header">
          <h2 className="settings-title">⚙️ Настройки</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
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
                >
                  {m.label}
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
        </div>
      </div>
    </div>
  );
}
