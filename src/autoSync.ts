// Автосинхронизация данных через файл daily-planner-sync.json в заданной папке.
//
// Принцип (last-write-wins для одного пользователя):
//  - экспорт: после каждого изменения данных приложение пишет полный JSON-бэкап
//    в файл (debounce 2 с — серия правок даёт один бэкап, не файл на клик);
//    если содержимое не изменилось с прошлого экспорта — файл НЕ переписываем
//    (решает Rust: бэкап и файл не проходят через webview, JS держит таймеры);
//  - импорт: при старте и раз в минуту проверяет файл: если exportedAt новее
//    последней синхронизации — файл писал другой экземпляр приложения
//    (другое устройство/запуск), данные заменяются полностью (как ручной импорт).
//
// Путь файла фиксирует Rust: команды принимают только ПАПКУ (выбранную
// системным диалогом), поэтому задать произвольный путь из webview нельзя.
// Ошибка чтения (папка отозвана/перемещена) — это НЕ «файла нет»: о ней
// сообщаем, иначе автоимпорт молча выключался бы навсегда.
//
// Работает в Tauri на десктопе: папка — абсолютный путь. На Android std::fs
// не понимает content:// из системных диалогов, поэтому автосинк там не
// предлагается (ручной экспорт/импорт работает через плагин fs).
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import { showToast } from "./toast";
import { t } from "./i18n";

const IMPORT_CHECK_MS = 60_000;
const EXPORT_DEBOUNCE_MS = 2_000;
/** Вотчдог экспорта: зависшая запись не должна навсегда блокировать импорт. */
const EXPORT_WATCHDOG_MS = 30_000;
const TOAST_INTERVAL_MS = 5 * 60_000;

/** Автосинк возможен только по реальному пути (content:// — не умеем). */
function usable(path: string): boolean {
  return !!path && !path.startsWith("content://");
}

let exportTimer: ReturnType<typeof setTimeout> | null = null;
/** Идёт экспорт: минутная проверка импорта ждёт, иначе прочитала бы свой же
 *  только что записанный файл в окне между write и setAutoSyncLastAt. */
let exporting = false;
let lastToastAt = 0;

/** Сообщение о сбое синхронизации — не чаще раза в 5 минут (иначе тост на
 *  каждую минутную проверку). */
function toastOnce(msg: string) {
  const now = Date.now();
  if (now - lastToastAt < TOAST_INTERVAL_MS) return;
  lastToastAt = now;
  showToast(msg);
}

/** Отложенный экспорт: вызывается из App после каждого изменения данных. */
export function scheduleAutoExport() {
  const { autoSyncEnabled, autoSyncPath } = useStore.getState();
  if (!autoSyncEnabled || !usable(autoSyncPath)) return;
  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    exportTimer = null;
    void doExport();
  }, EXPORT_DEBOUNCE_MS);
}

async function doExport() {
  const { autoSyncPath, autoSyncLastAt, setAutoSyncLastAt } =
    useStore.getState();
  exporting = true;
  const watchdog = setTimeout(() => {
    exporting = false;
  }, EXPORT_WATCHDOG_MS);
  try {
    // null — содержимое не менялось, файл не тронут.
    const exportedAt = await invoke<number | null>("sync_export", {
      dir: autoSyncPath,
    });
    // Помечаем синхронизацию: свой же файл на следующей проверке не импортируем.
    if (exportedAt) setAutoSyncLastAt(Math.max(autoSyncLastAt, exportedAt));
  } catch (e) {
    console.error("Автоэкспорт не удался:", e);
  } finally {
    clearTimeout(watchdog);
    exporting = false;
  }
}

/**
 * Проверка «есть ли свежий файл от другого экземпляра» — импорт при
 * необходимости. onImported вызывается после успешного импорта (App делает
 * reload). Идемпотентно: если файл не новее — ничего не делает.
 */
export async function checkForImport(onImported: () => void): Promise<void> {
  const { autoSyncEnabled, autoSyncPath, autoSyncLastAt, setAutoSyncLastAt } =
    useStore.getState();
  if (!autoSyncEnabled || !usable(autoSyncPath)) return;
  // Свой экспорт в полёте или ещё ждёт дебаунса: импорт сейчас заменил бы
  // базу целиком и стёр несохранённую в файл правку — проверим в следующий раз.
  if (exporting || exportTimer) return;
  let exportedAt: number | null;
  try {
    // null — файла нет, он не новее или бэкап битый (лог на стороне Rust).
    exportedAt = await invoke<number | null>("sync_import", {
      dir: autoSyncPath,
      lastAt: autoSyncLastAt,
    });
  } catch (e) {
    // НЕ «файла нет»: папка отозвана/перемещена/недоступна — сообщаем.
    console.error("Автосинхронизация: файл не читается:", e);
    toastOnce(t("err.syncRead"));
    return;
  }
  if (!exportedAt) return;
  setAutoSyncLastAt(exportedAt);
  onImported();
}

/** Запустить цикл проверки импорта (при старте и раз в минуту). Возвращает
 *  функцию остановки для cleanup. */
export function startAutoSync(onImported: () => void): () => void {
  void checkForImport(onImported);
  const timer = setInterval(() => {
    void checkForImport(onImported);
  }, IMPORT_CHECK_MS);
  return () => clearInterval(timer);
}
