// Лёгкий механизм тостов: единственный слушатель (App) рендерит сообщение,
// любой компонент вызывает showToast. Не храним в zustand — тост это
// транзиентное UI-состояние, его не нужно персистить и держать в сторе.

type Listener = (msg: string) => void;

let listener: Listener | null = null;

/** Зарегистрировать рендерер тостов (вызывает App при монтировании). */
export function setToastListener(l: Listener | null) {
  listener = l;
}

/**
 * Снять слушатель, только если он всё ещё этот же. Обычный setToastListener(null)
 * при быстром перемонтировании (StrictMode) гасил уже зарегистрированный новый —
 * тосты после ремаунта молча пропадали.
 */
export function clearToastListener(l: Listener) {
  if (listener === l) listener = null;
}

/** Показать тост: например, «Не удалось сохранить задачу». */
export function showToast(msg: string) {
  listener?.(msg);
}
