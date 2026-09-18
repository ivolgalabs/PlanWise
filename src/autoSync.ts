// Автосинхронизация данных через файл daily-planner-sync.json в заданной папке.
//
// Принцип (last-write-wins для одного пользователя):
//  - экспорт: после каждого изменения данных приложение пишет полный JSON-бэкап
//    в файл (debounce 2 с — серия правок даёт один бэкап, не файл на клик);
//  - импорт: при старте и раз в минуту проверяет файл: если exportedAt новее
//    последней синхронизации — файл писал другой экземпляр приложения
//    (другое устройство/запуск), данные заменяются полностью (как ручной импорт).
//
// Работает в Tauri на десктопе: папка — абсолютный путь. На Android std::fs
// не понимает content:// из системных диалогов, поэтому автосинк там не
// предлагается (ручной экспорт/импорт работает через плагин fs).
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";

const SYNC_FILE_NAME = "daily-planner-sync.json";
const IMPORT_CHECK_MS = 60_000;
const EXPORT_DEBOUNCE_MS = 2_000;

/** Полный путь файла синхронизации в заданной папке (без хвостовых «/»). */
function syncFilePath(dir: string): string {
  return `${dir.replace(/\/+$/, "")}/${SYNC_FILE_NAME}`;
}

/** Автосинк возможен только по реальному пути (content:// — не умеем). */
function usable(path: string): boolean {
  return !!path && !path.startsWith("content://");
}

let exportTimer: ReturnType<typeof setTimeout> | null = null;
/** Идёт экспорт: минутная проверка импорта ждёт, иначе прочитала бы свой же
 *  только что записанный файл в окне между write и setAutoSyncLastAt. */
let exporting = false;

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

/** exportedAt из JSON бэкапа; 0 — битый/без метки (такой не импортируем). */
function exportedAtOf(json: string): number {
  try {
    return (JSON.parse(json) as { exportedAt?: number }).exportedAt ?? 0;
  } catch {
    return 0;
  }
}

async function doExport() {
  const { autoSyncPath, autoSyncLastAt, setAutoSyncLastAt } = useStore.getState();
  exporting = true;
  try {
    const json = await invoke<string>("export_json");
    await invoke("write_sync_file", {
      path: syncFilePath(autoSyncPath),
      content: json,
    });
    // Помечаем синхронизацию: свой же файл на следующей проверке не импортируем.
    setAutoSyncLastAt(Math.max(autoSyncLastAt, exportedAtOf(json) || Date.now()));
  } catch (e) {
    // Папка недоступна/нет прав — молча ждём следующего раза (не спамим).
    console.error("Автоэкспорт не удался:", e);
  } finally {
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
  if (exporting) return; // свой экспорт в полёте — не импортируем свой же файл
  let raw: string;
  try {
    raw = await invoke<string>("read_sync_file", {
      path: syncFilePath(autoSyncPath),
    });
  } catch {
    return; // файла нет — нечего импортировать
  }
  if (!raw) return;
  const exportedAt = exportedAtOf(raw);
  if (exportedAt <= 0 || exportedAt <= autoSyncLastAt) return;
  try {
    await invoke<number>("import_json", { json: raw });
    setAutoSyncLastAt(exportedAt);
    onImported();
  } catch (e) {
    console.error("Автоимпорт не удался:", e);
  }
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
