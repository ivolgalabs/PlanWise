import { useState } from "react";
import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId, planGroupZoneId } from "../drag";
import { useStore } from "../store";
import { sortSomedayTasks, toEpochDay } from "../date";
import { showToast } from "../toast";
import { useI18n, type TKey } from "../i18n";

interface Props {
  tasks: Task[];
  onChange: () => void;
  /** Растянуть на всю высоту панели (когда мини-календарь скрыт/в месяце),
   *  чтобы под секцией не оставалось пустоты. */
  stretch?: boolean;
}

/** Группа «Когда-нибудь»: как её разбить по горизонту плана. Без срока
 *  или свыше месяца — «Когда-нибудь», со сроком в пределах недели — «В течение недели»,
 *  в пределах месяца — «В течение месяца», с истёкшим сроком — «Просроченные». */
type GroupKey = "overdue" | "week" | "month" | "someday";
/** Ключи словаря, а не готовые строки: подписи собираются на каждом рендере,
 *  поэтому смена языка их сразу подхватывает. */
const GROUPS: { key: GroupKey; label: TKey; placeholder?: TKey }[] = [
  { key: "overdue", label: "someday.overdue" },
  { key: "week", label: "someday.week", placeholder: "someday.addWeek" },
  { key: "month", label: "someday.month", placeholder: "someday.addMonth" },
  { key: "someday", label: "common.someday", placeholder: "someday.addSomeday" },
];

/** К какой группе относится задача по её мягкому сроку. */
function bucket(t: Task, today: number): GroupKey {
  const d = t.dueEpochDay ?? null;
  if (d == null) return "someday";
  if (d < today) return "overdue";
  if (d <= today + 7) return "week";
  if (d <= today + 30) return "month";
  return "someday";
}

/** Секция «Когда-нибудь» внутри правой панели: сворачиваемые группы
 *  (Просроченные / В течение недели / В течение месяца / Когда-нибудь). Принимает задачи
 *  drag-ом; перенос в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange, stretch = false }: Props) {
  const { t } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });
  const sortMode = useStore((s) => s.sortMode);
  // Свёрнутые группы: по умолчанию все развёрнуты.
  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>({
    overdue: false,
    someday: false,
    week: false,
    month: false,
  });
  const today = toEpochDay(new Date());
  const sorted = sortSomedayTasks(tasks, sortMode);
  const groups = GROUPS.map((g) => ({
    ...g,
    items: sorted.filter((t) => bucket(t, today) === g.key),
  })).filter((g) => g.key !== "overdue" || g.items.length > 0);

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        // Скроллится весь столбец, а не отдельные группы: раньше развёрнутые
        // группы (flex: 1 1 0) при нехватке высоты сжимались в 0 и их
        // заголовки наслаивались друг на друга.
        maxHeight: stretch ? "none" : "45%",
        minHeight: 0,
        overflowY: "auto",
        borderTop: `1px solid var(--border-color)`,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      {groups.map((g) => {
        const isCollapsed = collapsed[g.key];
        return (
          <PlanGroup key={g.key} groupKey={g.key}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))
              }
              title={isCollapsed ? t("common.expand") : t("common.collapse")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                // Верхний отступ меньше: секция сидит ближе к календарю.
                padding: "var(--sp-1) var(--sp-3)",
                fontSize: "var(--fs-sm)",
                fontWeight: 700,
                color: g.key === "overdue" ? "var(--danger, #e53935)" : "var(--accent-text)",
                display: "flex",
                alignItems: "center",
                gap: "var(--sp-2)",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: "var(--fs-xs)",
                  width: 12,
                  flexShrink: 0,
                  display: "inline-block",
                  transform: isCollapsed ? "rotate(-90deg)" : "none",
                  transition: "transform 120ms",
                }}
              >
                ▾
              </span>
              {t(g.label)}
              <span style={{ fontSize: "var(--fs-2xs)", color: g.key === "overdue" ? "var(--danger, #e53935)" : COLORS.muted, fontWeight: 400 }}>
                {g.items.length}
              </span>
            </button>
            {!isCollapsed && (
              <>
                <div style={{ display: "flex", flexDirection: "column", padding: 4 }}>
                  {g.items.map((t) => (
                    <TaskCard key={t.id} task={t} onChange={onChange} showTime={false} />
                  ))}
                  {g.items.length === 0 && (
                    <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                      {t("someday.empty")}
                    </p>
                  )}
                </div>
                {/* Форма: «Далее/Готово» на мобильной клавиатуре добавляет
                    задачу сразу в эту группу (с соответствующим сроком). */}
                {g.placeholder && (
                  <GroupAdd
                    placeholder={t(g.placeholder)}
                    key={g.key}
                    dueEpochDay={g.key === "week" ? today + 7 : g.key === "month" ? today + 30 : null}
                    onChange={onChange}
                  />
                )}
              </>
            )}
          </PlanGroup>
        );
      })}
    </div>
  );
}

/** Обёртка группы: droppable-зона для переноса задачи именно в эту группу.
 *  Внешняя колонка тоже droppable («когда-нибудь»), но вложенная зона группы
 *  выигрывает у неё при наведении (pointerWithin — сначала точная зона под
 *  курсором), поэтому сброс на «неделю/месяц» задаёт срок, а не снимает его. */
function PlanGroup({ groupKey, children }: { groupKey: GroupKey; children: ReactNode }) {
  const isDroppable = groupKey !== "overdue";
  const { setNodeRef, isOver } = useDroppable({
    id: isDroppable ? planGroupZoneId(groupKey) : `pg-disabled:${groupKey}`,
    disabled: !isDroppable,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        // Группа всегда по высоте контента (заголовок + задачи/поля),
        // чтобы заголовки не налезали друг на друга. Колонка скроллится.
        flex: "0 0 auto",
        background: isOver ? accentTint(0.12) : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** Строка добавления задачи в группу; создаёт «Когда-нибудь»-задачу с
 *  заданным мягким сроком (null для «Когда-нибудь»). */
function GroupAdd({
  placeholder,
  dueEpochDay,
  onChange,
}: {
  placeholder: string;
  dueEpochDay: number | null;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const add = async () => {
    const title = value.trim();
    if (!title) return;
    try {
      await api.upsertTask({ title, date: 0, someday: true, dueEpochDay });
      setValue("");
    } catch (e) {
      showToast(t("err.saveTask", { error: String(e) }));
    }
    onChange();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 4 }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="done"
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
      {/* Видимая кнопка добавления: на Android «Готово» у enterKeyHint="done"
          может не отправить Enter-keypress, и форма молча не отправлялась —
          задача не создавалась. Тап по «+» работает всегда. */}
      <button
        type="submit"
        className="icon-btn"
        aria-label={t("someday.addAria")}
        disabled={!value.trim()}
        style={{ flexShrink: 0, opacity: value.trim() ? 1 : 0.45 }}
      >
        +
      </button>
    </form>
  );
}
