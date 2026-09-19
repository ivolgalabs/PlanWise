// ── Блок оформления (Universal UI / theme-block) — точка входа ──────────
// Готовый модуль «темы и выбор оформления»: статус активной темы, вкладки
// «Стандартные / Свой выбор / Мои стили», OLED, масштаб интерфейса и шрифта,
// библиотека стилей с TMT-кодом.
//
// Подключение в проект:
//   import ThemeSettings from "…/Universal UI/theme-block";
//   <ThemeSettings lang={lang} themeMode={mode} setThemeMode={setMode}
//                  prefLight={..} setPrefLight={..} prefDark={..} setPrefDark={..}
//                  useOled={..} setUseOled={..}
//                  customLight={..} setCustomLight={..}
//                  customDark={..} setCustomDark={..}
//                  presets={..} setPresets={..}
//                  resolvedTheme={..} activeSlot={..} draft={..} setDraft={..}
//                  zoom={..} setZoom={..} fontScale={..} setFontScale={..}
//                  systemIsDark={..} onClose={..} />
// CSS: theme-status.css + theme-block.css (см. README.md).
export { default as ThemeSettings, type ThemeSettingsProps } from "./ThemeSettings";
export { default } from "./ThemeSettings";
export * from "./themeModel";
export { THEME_APP, getThemeT, type ThemeLang } from "./i18n";
