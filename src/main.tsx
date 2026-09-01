import React from "react";
import ReactDOM from "react-dom/client";
// Диагностика: фатальные JS-ошибки пишем в заголовок окна и поверх экрана —
// если фронт падает, причину видно сразу (окно белое, а в титуле ошибка).
window.addEventListener("error", (e) => {
  // ResizeObserver loop — безвредное предупреждение движка (наблюдатель
  // дожмёт изменение на следующем кадре), оверлей на нём не нужен.
  if (e.message?.includes("ResizeObserver loop")) return;
  document.title = "ERR: " + e.message;
  const dark = document.documentElement.style.backgroundColor === "rgb(18, 19, 22)" ||
    ((localStorage.getItem("todo-settings") ?? "").includes('"themeMode":"dark"'));
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;inset:0;z-index:99999;" +
    (dark ? "background:#121316;color:#ff8a80;" : "background:#fff;color:#c00;") +
    "padding:20px;font:14px monospace;white-space:pre-wrap";
  div.textContent = "JS ERROR: " + e.message + "\n" + (e.error?.stack ?? "");
  document.body.appendChild(div);
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String(e.reason?.message ?? e.reason);
  document.title = "REJ: " + msg;
});
// Диагностический маркер «фронт стартовал»: пишется при КАЖДОМ запуске
// (localStorage иначе не меняется — zustand пишет только при изменении
// настроек, и по нему нельзя понять, жива ли страница).
try {
  localStorage.setItem("ezh-diag-start", String(Date.now()));
} catch { /* не критично */ }
// Точечные импорты Universal UI: приложение использует только токены,
// темы, типографику и мобильную базу. Полный all.css тянул бы неиспользуемые
// слои (кнопки, иконки, тосты и т.д.) и конфликтовал классами .icon-btn
// и .preset-btn (components.css задаёт им height: 38px !important).
import "universal-ui/tokens.css";
import "universal-ui/themes.css";
import "universal-ui/typography.css";
import "universal-ui/theme-status.css";
import "./App.css";
// Мобильная база ПОСЛЕ App.css: её мобильные правила (touch-таргеты,
// типографика, двухстрочная шапка) имеют ту же специфичность, что базовые
// классы App.css, и должны перекрывать их на тач-устройствах/узком окне.
import "universal-ui/mobile.css";
import App from "./App";
import { useStore } from "./store";

// Deep-link: тап по уведомлению (Android/Mac) → плагин шлёт событие
// «actionPerformed», в notification.extra.taskId — id задачи. Слушаем на
// уровне модуля (до маунта React), чтобы поймать событие и при холодном
// старте: Tauri ставит его в очередь и отдаёт после загрузки страницы
// (внутри React-based подписки могли бы его пропустить). В браузере-фолбэке
// импорт просто резолвится, listen отклоняется без Tauri — гасим.
try {
  import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen("actionPerformed", (e) => {
        const p = e.payload as { notification?: { extra?: { taskId?: string } } };
        const taskId = p?.notification?.extra?.taskId;
        if (taskId) useStore.getState().setFocusTask(String(taskId));
      }),
    )
    .catch(() => {});
} catch { /* не критично */ }

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
