import { useCallback, useEffect, useRef, useState } from "react";
import type { Subtask } from "./api";
import { api } from "./api";
import { useStore } from "./store";

/**
 * Подзадачи задачи: загрузка + перезагрузка с защитой от гонки размонтирования
 * (alive-guard). Единый источник для SubtaskList, месяца и поиска — раньше
 * каждая копия писала свой useEffect с флагом alive.
 * `rev` — внешняя версия списка: месяц бампает её после переименования/
 * удаления, чтобы список перечитался. Без rev подхватывается глобальный
 * subtaskRev из стора (promote/смена родителя в drag.tsx).
 */
export function useSubtasks(taskId: string, rev?: number) {
  const [items, setItems] = useState<Subtask[]>([]);
  const [error, setError] = useState(false);
  const storeRev = useStore((s) => s.subtaskRev);
  const effectiveRev = rev ?? storeRev;
  const aliveRef = useRef(true);
  // Номер запроса: ответ старого taskId не должен перетирать список нового
  // (переиспользование инстанса хука при смене задачи).
  const seqRef = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      setError(false);
      const list = await api.getSubtasks(taskId);
      if (aliveRef.current && seq === seqRef.current) setItems(list);
    } catch {
      // Старые items остаются (не мигаем пустотой), ошибка — флагом.
      if (aliveRef.current && seq === seqRef.current) setError(true);
    }
  }, [taskId]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, effectiveRev]);

  return { items, error, reload };
}
