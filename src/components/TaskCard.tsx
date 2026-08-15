import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api, fromEpochDay } from "../api";
import { COLORS, accentTint, argbToHex } from "../theme";
import { useStore } from "../store";
import { showToast } from "../toast";
import { formatMinutes } from "../date";
import { useMediaQuery } from "../useMediaQuery";
import { SubtaskList } from "./SubtaskList";
import { AddTaskModal } from "./AddTaskModal";
import { Icon } from "./Icon";
import { taskIdZone } from "../drag";

interface Props {
  task: Task;
  onChange: () => void;
  /** Создать новую пустую задачу сразу после этой (расширение по Enter). */
  onCreateNext?: (afterTaskId: string) => void;
  /** Показывать ли время задачи. По умолчанию true; компактная сетка недели
   *  рендерит время в компактном виде. */
  showTime?: boolean;
  /** Компактный режим для узких колонок сетки недели: меньше накладные
   *  отступы ручки/полоски/чекбокса, чтобы влезало поле задачи (≥40px). */
  compact?: boolean;
}

/** Сравнение задач по содержимому для memo: после reload() ВСЕ объекты задач
 *  приходят новыми (invoke создаёт новые), сравнение по ссылке всегда ложно —
 *  без поэлементного сравнения мемоизация не работала бы вовсе.
 *  createdAt/updatedAt/deviceId не влияют на отрисовку — не сравниваем. */
function taskEquals(a: Task, b: Task): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.date === b.date &&
    a.isDone === b.isDone &&
    a.colorSetId === b.colorSetId &&
    a.sortOrder === b.sortOrder &&
    a.notes === b.notes &&
    a.someday === b.someday &&
    a.archived === b.archived &&
    a.timeMinutes === b.timeMinutes &&
    a.travelTime === b.travelTime &&
    a.durationMinutes === b.durationMinutes &&
    a.difficulty === b.difficulty &&
    a.notifyMinutes === b.notifyMinutes
  );
}

/**
 * Строка задачи: чекбокс + текст + время (ТОЛЬКО отображение) + цветной маркер
 * приоритета и линия категории. Клик/тап по тексту — редактирование текста
 * прямо в строке (на десктопе с выделением). Все настройки (время, приоритет,
 * категория, длительность, заметка, перенос, удаление, уведомление) — в
 * карточке задачи, которая открывается кнопкой «✎» справа от строки.
 * Заметка, если есть, видна под текстом (настройка «Заметки»).
 * Перетаскивается через @dnd-kit.
 *
 * memo: клик по чекбоксу вызывает reload() и перерисовывает все виды целиком;
 * без мемо каждая неизменившаяся строка заново рендерится (а строк в неделе —
 * десятки). Компаратор ниже пропускает render, когда задача не изменилась.
 */
export const TaskCard = memo(function TaskCard({
  task,
  onChange,
  onCreateNext,
  showTime = true,
  compact = false,
}: Props) {
  const [title, setTitle] = useState(task.title);
  const [editing, editingSetter] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Ref на строку задачи: высота «шапки» (время/приоритет над текстом) в
  // компактной сетке измеряется в рантайме, а не константой — в WebKit
  // (WKWebView) высоты бейджей отличаются от Blink, и фиксированный сдвиг
  // давал разъехавшиеся чекбокс/ручку/кнопку.
  const lineRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const checkRef = useRef<HTMLLabelElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  // Метрики компактной сетки: сдвиг «шапки» (время/приоритет над текстом),
  // высота строки текста и высоты элементов строки. По ним каждый элемент
  // сдвигается так, чтобы его ЦЕНТР совпал с центром первой строки текста —
  // единая формула вместо разрозненных констант (4/5/2), которые в WebKit
  // давали разнобой в 1–5px.
  const [metrics, setMetrics] = useState({
    shift: 0,
    lineH: 18,
    padTop: 4,
    handleH: 16,
    checkH: 26,
    editH: 20,
  });
  // Текущие метрики для сравнения в ResizeObserver (без лишних setState).
  const metricsRef = useRef(metrics);
  // Авто-высота textarea: растёт по контенту. В компактной сетке недели
  // свёрнутая строка — максимум 4 строки, срез по ГРАНИЦЕ строк (не 96px:
  // фикс-пиксели при крупном шрифте резали текст посередине слова, а хвост
  // длинных задач был вообще не виден). При редактировании и вне сетки
  // (День, вертикальная неделя, «Когда-нибудь») капа нет — текст виден
  // целиком, список скроллится.
  const clampHeight = (el: HTMLTextAreaElement, expanded: boolean) => {
    let h = el.scrollHeight;
    if (compact && !expanded) {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight);
      const pt = parseFloat(cs.paddingTop);
      const pb = parseFloat(cs.paddingBottom);
      if (Number.isFinite(lh) && lh > 0) {
        h = Math.min(h, pt + pb + lh * 4);
      }
    }
    return h;
  };
  const growTitle = (el: HTMLTextAreaElement, expanded: boolean) => {
    el.style.height = "auto";
    el.style.height = clampHeight(el, expanded) + "px";
    // WebKit (WKWebView — движок приложения): сразу после height:auto
    // scrollHeight отдаёт ПРОШЛОЕ значение (перенос строк пересчитывается
    // асинхронно) — высота выходила на строку меньше и текст резался.
    // Через 2 кадра дотягиваем: при фиксированной высоте scrollHeight
    // честный (= полный контент), запись только если текст не влез.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.style.height = clampHeight(el, expanded) + "px";
        }
      }),
    );
  };
  // Защита от двойного save: Enter (onKeyDown) и следующий за ним blur
  // (onBlur) вызывают save дважды подряд — пропускаем повторный вызов.
  const savedRef = useRef<number>(0);
  // Селекторы: подписка только на нужные поля (иначе любой set() в сторе
  // перерендеривал бы каждую карточку задачи).
  const colorSets = useStore((s) => s.colorSets);
  const visibility = useStore((s) => s.visibility);
  // ── Пересечения по времени ────────────────────────────────────────
  // Задача «занимает» интервал [start, start+duration); без длительности —
  // одну минуту (мгновение). Одинаковое время двух задач = наложение.
  const intervalsOverlap = (m1: number, d1: number, m2: number, d2: number) =>
    m1 < m2 + Math.max(d2, 1) && m2 < m1 + Math.max(d1, 1);
  // Селектор возвращает ПРИМИТИВ (id конфликтующей задачи или null):
  // подписка перерисовывает карточку только когда сам факт конфликта
  // изменился. Подписка на весь массив s.tasks (как было) рендерила ВСЕ
  // карточки на любое изменение любой задачи — мемоизация была бессильна.
  const conflictId = useStore((s) => {
    if (task.timeMinutes == null || task.isDone) return null;
    const d1 = task.durationMinutes ?? 0;
    const other = s.tasks.find(
      (t) =>
        t.id !== task.id &&
        !t.isDone &&
        !t.archived &&
        !t.someday &&
        t.date === task.date &&
        t.timeMinutes != null &&
        intervalsOverlap(task.timeMinutes!, d1, t.timeMinutes, t.durationMinutes ?? 0),
    );
    return other?.id ?? null;
  });
  // На тач-устройствах время и мета собираются под текстом (компактно),
  // на десктопе — в ряд с текстом. Один общий listener на запрос — см.
  // useMediaQuery (раньше каждая задача вешала свой matchMedia-listener).
  const isTouch = useMediaQuery("(pointer: coarse), (max-width: 560px)");
  // Мобильный компактный ряд (только вне компактной сетки недели).
  const mobileRow = isTouch && !compact;

  // Перетаскивание задачи через dnd-kit. data.task читается в onDragEnd.
  // transform НЕ применяется к строке: перемещение показывает DragOverlay
  // (призрак в drag.tsx), а оригинал гасится классом .dragging (opacity).
  // Если применить transform тоже, строка уезжает вслед за курсором ПОВЕРХ
  // соседних колонок (текст накладывается на другие задачи), а при потере
  // mouseup в WKWebView (отпускание за краем окна) drag не завершается —
  // и строка ОСТАЁТСЯ сдвинутой. У подзадач (SubtaskRow) transform
  // не применяется — тот же паттерн.
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({ id: task.id, data: { task } });
  // Задача — также droppable-зона: на неё можно бросить подзадачу (прикрепить).
  const { setNodeRef: setDropRef, isOver: isDropTarget } = useDroppable({
    id: taskIdZone(task.id),
  });

  // Синхронизируем локальный title, если задача изменилась извне.
  useEffect(() => {
    if (!editing) setTitle(task.title);
  }, [task.title, editing]);

  // При изменении текста/открытии/фокусе — подгоняем высоту textarea
  // (editing: при входе в редактирование кап строк снимается, при blur —
  // строка в сетке снова сворачивается до 4 строк).
  useEffect(() => {
    if (textareaRef.current) growTitle(textareaRef.current, editing);
  }, [title, compact, editing]);

  // Клик по пустому месту ячейки и другие колбэки вне рендера читают
  // актуальный editing через ref (см. ResizeObserver ниже).
  const editingRef = useRef(false);
  editingRef.current = editing;

  // Ширина textarea меняется уже ПОСЛЕ первичной раскладки (узкая панель
  // «Когда-нибудь», ресайз окна, открытие панели) — высота, посчитанная
  // growTitle при монтировании, устаревала, и длинный текст обрезался.
  // Пересчёт по ResizeObserver: запись той же высоты не меняет бокс,
  // повторных уведомлений и цикла нет.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => growTitle(ta, editingRef.current));
    ro.observe(ta);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // В компактной сетке измеряем всё, что нужно для выравнивания: сдвиг
  // «шапки» (textarea.offsetTop относительно строки), высоту строки текста
  // (line-height) и фактические высоты ручки/чекбокса/кнопки. Измерение
  // вместо констант: в WebKit (WKWebView) высоты бейджей и нативного
  // чекбокса отличаются от Blink, фикс-сдвиги давали «разъехавшиеся»
  // элементы (чекбокс уходил на 4–5px ниже текста из-за label 26px).
  // ResizeObserver: высота «шапки» меняется при изменении ширины колонки
  // (перенос бейджа/точки на новую строку) — без него после ресайза окна
  // элементы оставались со старым сдвигом и «разъезжались» на 2px.
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const measure = () => {
      const ta = line.querySelector("textarea");
      if (!ta) return;
      const lh = parseFloat(getComputedStyle(ta).lineHeight);
      const pt = parseFloat(getComputedStyle(ta).paddingTop);
      const next = {
        shift: ta.offsetTop,
        lineH: Number.isFinite(lh) ? lh : 18,
        padTop: Number.isFinite(pt) ? pt : 4,
        handleH: handleRef.current?.offsetHeight ?? 16,
        checkH: checkRef.current?.offsetHeight ?? 26,
        editH: editRef.current?.offsetHeight ?? 20,
      };
      // Без сравнения каждый reflow (в т.ч. drag-перетаскивание) дёргал бы
      // setState с новым объектом → лишние re-render всех строк сетки.
      if (
        next.shift !== metricsRef.current.shift ||
        next.lineH !== metricsRef.current.lineH ||
        next.padTop !== metricsRef.current.padTop ||
        next.handleH !== metricsRef.current.handleH ||
        next.checkH !== metricsRef.current.checkH ||
        next.editH !== metricsRef.current.editH
      ) {
        metricsRef.current = next;
        setMetrics(next);
      }
    };
    measure();
    // Наблюдаем за обёрткой текста: её высота меняется при переносе «шапки»,
    // появлении/исчезновении времени и росте textarea — всё это влияет
    // на offsetTop текста, по которому выравниваются элементы строки.
    const wrap = line.querySelector<HTMLElement>(".task-text-wrap");
    if (!wrap) return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, visibility.taskTime, task.timeMinutes, task.difficulty]);

  const save = async (): Promise<Task> => {
    const t = title.trim();
    // Enter+blur дублируют вызов в течение <300мс — пропускаем повтор.
    const now = Date.now();
    if (now - savedRef.current < 300) return task;
    // Авто-удаление при пустом тексте — ТОЛЬКО если задача изначально была
    // пустой (создана Enter-ом и забыта).
    if (!t) {
      if (!task.title) {
        try {
          const subs = await api.getSubtasks(task.id);
          if (subs.length === 0) {
            await api.deleteTask(task.id);
            onChange();
            return task;
          }
        } catch {
          /* не критично — оставим как есть */
        }
      }
      return task;
    }
    if (t !== task.title) {
      try {
        const updated = await api.upsertTask({ ...task, title: t });
        // Дедупликацию включаем только после РЕАЛЬНОЙ записи: blur без
        // изменений не должен съедать быстрое сохранение следующим Enter-ом.
        savedRef.current = now;
        onChange();
        return updated;
      } catch (err) {
        // Сбой БД/диска — НЕ молчим: показываем тост и перезагружаем,
        // чтобы строка вернулась к сохранённому в БД тексту (иначе правка
        // «выглядит» сохранённой, но теряется).
        console.error("Не удалось сохранить задачу:", err);
        showToast("Не удалось сохранить задачу — проверьте данные приложения");
        onChange();
        return task;
      }
    }
    return task;
  };

  const toggleDone = async () => {
    try {
      await api.upsertTask({ ...task, isDone: !task.isDone });
      onChange();
    } catch (err) {
      console.error("Не удалось сохранить отметку задачи:", err);
      showToast("Не удалось сохранить задачу — проверьте данные приложения");
      onChange();
    }
  };

  const setEditing = (v: boolean) => editingSetter(v);

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing && // игнорируем Enter во время IME-композиции
      (e.currentTarget.tagName !== "TEXTAREA" || !e.shiftKey)
    ) {
      e.preventDefault();
      const saved = await save();
      setEditing(false);
      // Создаём новую строку ниже и переводим на неё фокус.
      onCreateNext?.(saved.id);
    } else if (e.key === "Escape") {
      setTitle(task.title);
      setEditing(false);
    } else if (
      e.key === "Backspace" &&
      title === "" &&
      !task.title // удаляем только если задача была пустой
    ) {
      e.preventDefault();
      if (!task.title) {
        try {
          const subs = await api.getSubtasks(task.id);
          if (subs.length === 0) {
            await api.deleteTask(task.id);
            onChange();
          }
        } catch {
          /* не критично */
        }
      }
    }
  };

  // Цвет категории задачи (линия слева на весь блок).
  const taskSet = colorSets.find((s) => s.id === task.colorSetId);
  const setHex = taskSet ? argbToHex(taskSet.color) : undefined;

  // Приоритет задачи — цветной маркер в строке (не редактируется здесь,
  // меняется в карточке). Цвета — глобальные CSS-переменные приоритета
  // (themes.css), адаптируются к теме как остальная палитра.
  const PRIO_META: Record<number, { label: string; color: string }> = {
    1: { label: "низкий", color: "var(--prio-low)" },
    2: { label: "средний", color: "var(--prio-med)" },
    3: { label: "высокий", color: "var(--prio-high)" },
  };
  const prioMeta = PRIO_META[task.difficulty ?? 0];

  // Время показываем, только если его запросил родитель И настройка
  // «Время задач» включена.
  const effectiveShowTime = showTime && visibility.taskTime;

  // Наложение: задача, чьё время пересекается с другой (видны и старые
  // конфликты). Подсветка — цветной фон строки и красное время.
  // Считается селектором conflictId выше — см. комментарий там.
  const timeConflict = conflictId !== null;
  // Карточка задачи (окно с полными настройками) — открывается ТОЛЬКО кнопкой
  // «✎» в строке задачи (в т.ч. из подзадач); у пустой строки-заглушки кнопка
  // просто ставит курсор.
  const [cardOpen, setCardOpen] = useState(false);

  // Время в строке — ТОЛЬКО отображение (изменение — в карточке задачи).
  // Бейдж: при длительности — диапазон «09:00–10:30» (стартовое время в нём
  // уже есть, отдельно не дублируется), без неё — «09:00». Мета: выезд.
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const timeMeta: string[] = [];
  if (task.timeMinutes != null && task.travelTime) {
    const dep = (task.timeMinutes - task.travelTime + 24 * 60) % (24 * 60);
    timeMeta.push(`выезд в ${fmt(dep)}`);
  }
  const timeText =
    task.timeMinutes != null
      ? task.durationMinutes
        ? (() => {
            const total = task.timeMinutes! + task.durationMinutes!;
            const days = Math.floor(total / (24 * 60));
            return `${fmt(task.timeMinutes!)}–${fmt(total % (24 * 60))}${days > 0 ? ` (+${days} дн.)` : ""}`;
          })()
        : formatMinutes(task.timeMinutes)
      : null;
  // Статичный «бейдж» времени: выглядит как раньше, но это не кнопка —
  // клик открывает карточку, где время настраивается.
  const timeBadge = (
    <span
      className={`task-time${task.timeMinutes != null ? " has" : ""}${timeConflict ? " conflict" : ""}`}
      title={timeConflict ? "Время пересекается с другой задачей" : task.timeMinutes != null ? "Нажмите, чтобы настроить время" : "Без привязки ко времени"}
    >
      {timeText ?? (compact ? "в теч. дня" : "в течение дня")}
    </span>
  );

  // Цветная точка приоритета. В compact-сетке — в строке времени (ровно с
  // бейджем); в остальных видах — в ряду задачи, по центру.
  const prioDot = prioMeta ? (
    <span
      title={`Приоритет: ${prioMeta.label}`}
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: prioMeta.color,
        flexShrink: 0,
        marginRight: "var(--sp-1)",
      }}
    />
  ) : null;

  // Блок времени (точка приоритета + бейдж + мета). Приоритет всегда рядом
  // с временем; если времени нет — точка стоит на его месте.
  // compact (сетка недели): строка времени НАД текстом, с отступом сверху
  // (иначе прижимается к предыдущей задаче). Не-compact (День, список):
  // в ряду с текстом.
  const showTimeRow = !mobileRow && (compact ? (prioMeta != null || task.timeMinutes != null) : (effectiveShowTime || prioMeta != null));
  // Выравнивание элемента строки по центру ПЕРВОЙ строки текста в компактной
  // сетке: строка «шапки» (время/приоритет, shift) + фактический padding
  // текста (padTop, в em — меняется со шрифтом) + пол-разницы высот. Центр
  // каждого элемента = центр первой строки текста, поэтому ручка/чекбокс/
  // кнопка стоят на одной линии.
  const alignTop = (elH: number) =>
    compact ? metrics.shift + metrics.padTop + (metrics.lineH - elH) / 2 : 0;
  const timeRow = showTimeRow ? (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--sp-2)",
        ...(compact
          ? {
              // Отступы в em: масштабируются вместе со шрифтом (он растёт с
              // шириной окна и настройкой «масштаб шрифта»). Фиксированные px
              // при крупном шрифте визуально схлопывались — текст задачи
              // «прилипал» к соседней.
              marginBottom: "0.15em",
              // Отступ от предыдущей задачи в колонке.
              marginTop: "0.3em",
            }
          : {
              // День/список: ряд с текстом. flexShrink:0 + nowrap — мета
              // не переносится второй строкой (иначе ряд «разъезжается»).
              flexShrink: 0,
            }),
      }}
    >
      {prioDot}
      {effectiveShowTime && timeBadge}
      {timeMeta.length > 0 && !compact && (
        <span
          style={{
            fontSize: "var(--fs-2xs)",
            color: COLORS.muted,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          {timeMeta.join(" · ")}
        </span>
      )}
    </div>
  ) : null;

  return (
    <div
      className="task-block"
      ref={setDropRef}
      style={{
        background: isDropTarget ? accentTint(0.08) : undefined,
        borderRadius: isDropTarget ? "var(--radius-sm)" : undefined,
        // Цветная линия категории слева — на весь блок (задача + подзадачи):
        // сразу видно, к какой категории относится задача.
        borderLeft: `3px solid ${setHex ?? "transparent"}`,
        paddingLeft: 4,
      }}
    >
    <div
      ref={(node) => {
        setNodeRef(node);
        lineRef.current = node;
      }}
      className={`task-line${isDragging ? " dragging" : ""}${timeConflict ? " time-conflict" : ""}`}
      style={{
        position: "relative",
        display: "flex",
        // В компактной сетке выравниваем по ПЕРВОЙ строке текста (flex-start),
        // а не по центру блока: когда под текстом появляется время, строка
        // становится выше, и центрирование «утапливало» чекбокс/ручку вниз —
        // ряд выглядел разъехавшимся. Строка времени (приоритет + бейдж)
        // рендерится внутри text-wrap НАД текстом, а ручка/чекбокс/кнопка
        // опускаются на её высоту (см. alignTop), оставаясь напротив текста.
        alignItems: compact ? "flex-start" : "center",
        background: timeConflict ? "color-mix(in srgb, var(--danger) 9%, transparent)" : "transparent",
        borderRadius: "var(--radius-sm)",
      }}
      title={timeConflict ? "Время пересекается с другой задачей" : undefined}
      onClick={(e) => {
        // Клик по элементам управления (чекбокс, ручка, поле текста, кнопка
        // «Редактировать») — их собственные обработчики. Любой другой клик
        // по строке (время, пустое место) — редактирование текста: фокус
        // в поле, на десктопе ещё и выделение всего текста.
        const t = e.target as HTMLElement;
        if (t.closest("input, button, label, select, textarea, .task-drag-hint")) return;
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        if (!isTouch) el.select();
      }}
      {...attributes}
    >
      {/* Ручка перетаскивания: ТОЛЬКО на ней listeners, чтобы клики по
          чекбоксу внутри строки работали. */}
      <span
        className="task-drag-hint"
        title="Зажмите и тяните на другой день"
        ref={handleRef}
        {...listeners}
        style={{
          flexShrink: 0,
          width: compact ? 16 : 20,
          marginRight: "var(--sp-2)",
          // В компактной сетке ряд выровнен по тексту; центр ручки совпадает
          // с центром первой строки текста (см. alignTop).
          marginTop: alignTop(metrics.handleH),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.secondary,
          opacity: 0.75,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon name="drag" size={16} />
      </span>
      <label
        className="checkbox-hit"
        ref={checkRef}
        title={task.isDone ? "Отметить невыполненной" : "Отметить выполненной"}
        style={{
          // Сдвигается САМ label (26px), а не input внутри: центр чекбокса
          // попадает в центр первой строки текста. Сдвиг input внутри label
          // (flex-центрирование) давал чекбокс на ~5px ниже текста.
          marginTop: alignTop(metrics.checkH),
        }}
      >
        <input
          type="checkbox"
          checked={task.isDone}
          onChange={toggleDone}
          style={{
            flexShrink: 0,
          }}
        />
      </label>
      {/* Цветной маркер приоритета — в строке времени (рядом с бейджем),
          см. timeRow; из ряда задачи убран, чтобы не дублироваться. */}
      {/* Текст + время + заметка. На мобильном CSS время переводит в колонку
          (под текстом); на десктопе — в ряд с текстом. */}
      <div
        className="task-text-wrap"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: compact ? "column" : "row",
          alignItems: compact ? "flex-start" : "center",
        }}
      >
        {/* compact (сетка недели): приоритет + время НАД текстом задачи —
            левый отступ совпадает с линией начала текста (обёртка стоит
            после ручки/чекбокса). */}
        {compact && timeRow}
        <textarea
          ref={textareaRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false);
            save();
          }}
          onKeyDown={onKeyDown}
          onInput={(e) => growTitle(e.currentTarget, editing)}
          onPointerDown={(e) => {
            // Десктоп: клик мышью по полю — автовыбор (фокус + выделение
            // всего текста), чтобы сразу перезаписывать задачу.
            if (e.pointerType === "mouse") {
              const el = e.currentTarget;
              requestAnimationFrame(() => {
                el.focus();
                el.select();
              });
            }
            // Тач — нативный фокус и курсор в месте тапа.
          }}
          rows={1}
          data-task-id={task.id}
          title={title || undefined}
          style={{
            // В компактной колонке (сетка недели) .task-text-wrap —
            // flex-КОЛОНКА: там это вертикальный flex, и в WebKit
            // (WKWebView — движок приложения) «1 1 auto» у заменяемого
            // элемента ломает высоту колонки — бейдж времени вылетал за
            // нижнюю границу строки и налезал на блок подзадач. Высоту
            // textarea всегда задаёт growTitle (style.height), flex не нужен.
            flex: compact ? "0 0 auto" : "1 1 auto",
            width: "100%",
            fontSize: "inherit",
            border: "none",
            background: "transparent",
            outline: "none",
            // em: вертикальный padding растёт вместе со шрифтом (окно шире →
            // шрифт крупнее), иначе зазор между задачами «схлопывался» и текст
            // прилипал к соседней задаче.
            padding: "0.3em 0",
            minWidth: 0,
            resize: "none",
            overflow: "hidden",
            lineHeight: 1.4,
            color: task.isDone ? COLORS.muted : COLORS.text,
            textDecoration: task.isDone ? "line-through" : "none",
          }}
        />
        {/* Не-compact (День, вертикальная неделя): время — в ряду с текстом. */}
        {!compact && timeRow}
        {mobileRow && effectiveShowTime && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--sp-2)",
              margin: "1px 0 2px",
              maxWidth: "100%",
            }}
          >
            {prioDot}
            {timeBadge}
            {timeMeta.length > 0 && (
              <span
                style={{
                  fontSize: "var(--fs-2xs)",
                  color: COLORS.muted,
                  lineHeight: 1.2,
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                }}
              >
                {timeMeta.join(" · ")}
              </span>
            )}
          </div>
        )}
        {/* Заметка — всегда под текстом, пока не скрыта настройкой. */}
        {visibility.notes && task.notes && (
          <div
            style={{
              fontSize: "var(--fs-2xs)",
              color: COLORS.muted,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              padding: "0 0 2px",
              maxWidth: "100%",
            }}
          >
            {task.notes}
          </div>
        )}
      </div>
      {/* Кнопка редактирования: ЕДИНСТВЕННЫЙ вход в карточку задачи (меню со
          временем, приоритетом, категорией и т.д.). Клик/тап по тексту —
          редактирование текста прямо в строке. class icon-btn: свайп по
          кнопке не переключает вид. */}
      <button
        type="button"
        className="icon-btn"
        ref={editRef}
        onClick={() => setCardOpen(true)}
        title="Редактировать задачу (время, категория, заметка…)"
        style={{
          flexShrink: 0,
          marginLeft: "var(--sp-1)",
          // В компактной сетке кнопка — напротив текста: центр кнопки
          // совпадает с центром первой строки (см. alignTop).
          alignSelf: compact ? "flex-start" : "center",
          marginTop: alignTop(metrics.editH),
          width: compact ? 20 : 24,
          height: compact ? 20 : 24,
        }}
      >
        <Icon name="edit" size={compact ? 12 : 14} />
      </button>
    </div>
    {/* Подзадачи под строкой (линия категории покрывает весь блок).
        Текст подзадачи редактируется прямо в строке; карточка родительской
        задачи открывается кнопкой «✎» выше. */}
    {visibility.subtasks && (
      <SubtaskList taskId={task.id} />
    )}
    {/* Карточка задачи: окно с полными настройками (время, приоритет,
        длительность, выезд, уведомление, категория, заметка, подзадачи,
        перенос, удаление) — открывается кнопкой «✎». */}
    {cardOpen && (
      <AddTaskModal
        day={fromEpochDay(task.date)}
        initial={task}
        onChange={onChange}
        onClose={() => setCardOpen(false)}
      />
    )}
    </div>
  );
},
// onCreateNext намеренно не сравниваем: коллбэк создаётся заново при каждом
// рендере родителя (inline в мапе дней), а его замыкание устаревает безопасно
// — при неизменной задаче день и sortOrder соседа дают тот же результат.
(prev, next) =>
  taskEquals(prev.task, next.task) &&
  prev.onChange === next.onChange &&
  prev.showTime === next.showTime &&
  prev.compact === next.compact,
);
