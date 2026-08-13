// Лёгкий механизм тостов: единственный слушатель (App) рендерит сообщение,
// любой компонент вызывает showToast. Не храним в zustand — тост это
// транзиентное UI-состояние, его не нужно персистить и держать в сторе.

type Listener = (msg: string) => void;

let listener: Listener | null = null;

/** Зарегистрировать рендерер тостов (вызывает App при монтировании). */
export function setToastListener(l: Listener | null) {
  listener = l;
}

/** Показать тост: например, «Не удалось сохранить задачу». */
export function showToast(msg: string) {
  listener?.(msg);
}
