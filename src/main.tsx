import React from "react";
import ReactDOM from "react-dom/client";
// Точечные импорты Universal UI: приложение использует только токены,
// темы и типографику. Полный all.css тянул бы неиспользуемые слои
// (кнопки, иконки, тосты и т.д.) и конфликтовал классами .icon-btn
// и .preset-btn (components.css задаёт им height: 38px !important).
import "universal-ui/tokens.css";
import "universal-ui/themes.css";
import "universal-ui/typography.css";
import "universal-ui/theme-status.css";
import "./App.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
