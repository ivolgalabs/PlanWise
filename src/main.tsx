import React from "react";
import ReactDOM from "react-dom/client";
// Диагностика: фатальные JS-ошибки пишем в заголовок окна и поверх экрана —
// если фронт падает, причину видно сразу (окно белое, а в титуле ошибка).
window.addEventListener("error", (e) => {
  // ResizeObserver loop — безвредное предупреждение движка (наблюдатель
  // дожмёт изменение на следующем кадре), оверлей на нём не нужен.
  if (e.message?.includes("ResizeObserver loop")) return;
  document.title = "ERR: " + e.message;
  const dark =
    document.documentElement.style.backgroundColor === "rgb(18, 19, 22)" ||
    (localStorage.getItem("todo-settings") ?? "").includes(
      '"themeMode":"dark"',
    );
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;inset:0;z-index:99999;" +
    (dark
      ? "background:#121316;color:#ff8a80;"
      : "background:#fff;color:#c00;") +
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
} catch {
  /* не критично */
}
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
import { I18nProvider, getLang, loadLang, t } from "./i18n";

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
        const p = e.payload as {
          notification?: { extra?: { taskId?: string } };
        };
        const taskId = p?.notification?.extra?.taskId;
        // Лог для диагностики deep-link (виден в консоли WebView при
        // отладке): помогает понять, дошло ли событие при холодном старте.
        if (taskId) {
          console.log("[deep-link] taskId", taskId);
          useStore.getState().setFocusTask(String(taskId));
        }
      }),
    )
    .catch(() => {});
} catch {
  /* не критично */
}

/** ErrorBoundary вокруг всего приложения: необработанная ошибка рендера React
 *  размонтирует всё дерево — пользователь видит белый экран без объяснения.
 *  Здесь любая такая ошибка превращается в видимое сообщение + кнопку
 *  перезагрузки, чтобы не гадать и можно было починить. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {t("app.fatalTitle")}
          </div>
          <pre
            style={{
              fontSize: 12,
              maxWidth: 640,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button onClick={() => location.reload()}>{t("app.reload")}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Словарь стартового языка — до первого рендера, чтобы не мигал английский.
void loadLang(getLang()).then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </I18nProvider>
    </React.StrictMode>,
  ),
);
