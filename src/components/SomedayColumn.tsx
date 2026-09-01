import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Task } from "../api";
import { api } from "../api";
import { COLORS, accentTint } from "../theme";
import { TaskCard } from "./TaskCard";
import { somedayZoneId } from "../drag";
import { useStore } from "../store";
import { sortSomedayTasks, toEpochDay } from "../date";

interface Props {
  tasks: Task[];
  onChange: () => void;
  /** Растянуть на всю высоту панели (когда мини-календарь скрыт/в месяце),
   *  чтобы под секцией не оставалось пустоты. */
  stretch?: boolean;
}

/** Группа «Когда-нибудь»: как её разбить по горизонту плана. Без срока —
 *  «Когда-нибудь», со сроком в пределах недели — «В течение недели», дальше —
 *  «В течение месяца». Это переиспользует мягкий срок (dueEpochDay) и даёт
 *  разграничение планов, не заводя их отдельные типы задач. */
type GroupKey = "someday" | "week" | "month";
const GROUPS: { key: GroupKey; label: string; placeholder: string }[] = [
  { key: "someday", label: "Когда-нибудь", placeholder: "+ когда-нибудь" },
  { key: "week", label: "В течение недели", placeholder: "+ на неделю" },
  { key: "month", label: "В течение месяца", placeholder: "+ на месяц" },
];

/** К какой группе относится задача по её мягкому сроку. */
function bucket(t: Task, today: number): GroupKey {
  const d = t.dueEpochDay ?? null;
  if (d == null) return "someday";
  return d <= today + 7 ? "week" : "month";
}

/** Секция «Когда-нибудь» внутри правой панели: три сворачиваемые группы
 *  (Когда-нибудь / В течение недели / В течение месяца). Принимает задачи
 *  drag-ом; перенос в день — обычным drag на колонку дня. */
export function SomedayColumn({ tasks, onChange, stretch = false }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: somedayZoneId });
  const sortMode = useStore((s) => s.sortMode);
  // Свёрнутые группы: по умолчанию все развёрнуты.
  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>({
    someday: false,
    week: false,
    month: false,
  });
  const today = toEpochDay(new Date());
  const sorted = sortSomedayTasks(tasks, sortMode);
  const groups = GROUPS.map((g) => ({
    ...g,
    items: sorted.filter((t) => bucket(t, today) === g.key),
  }));

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        maxHeight: stretch ? "none" : "45%",
        minHeight: 0,
        borderTop: `1px solid var(--border-color)`,
        background: isOver ? accentTint(0.08) : undefined,
      }}
    >
      {groups.map((g) => {
        const isCollapsed = collapsed[g.key];
        return (
          <div
            key={g.key}
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              // Развёрнутая группа растягивается; свёрнутая — по высоте
              // заголовка (не тянет панель на себя).
              flex: isCollapsed ? "0 0 auto" : "1 1 0",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))
              }
              title={isCollapsed ? "Развернуть" : "Свернуть"}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                // Верхний отступ меньше: секция сидит ближе к календарю.
                padding: "var(--sp-1) var(--sp-3)",
                fontSize: "var(--fs-sm)",
                fontWeight: 700,
                color: "var(--accent-text)",
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
              {g.label}
              <span style={{ fontSize: "var(--fs-2xs)", color: COLORS.muted, fontWeight: 400 }}>
                {g.items.length}
              </span>
            </button>
            {!isCollapsed && (
              <>
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: 4 }}>
                  {g.items.map((t) => (
                    <TaskCard key={t.id} task={t} onChange={onChange} showTime={false} />
                  ))}
                  {g.items.length === 0 && (
                    <p style={{ margin: 0, padding: "var(--sp-2) var(--sp-3)", fontSize: "var(--fs-2xs)", color: COLORS.muted }}>
                      Пусто. Перетащите сюда или напишите ниже.
                    </p>
                  )}
                </div>
                {/* Форма: «Далее/Готово» на мобильной клавиатуре добавляет
                    задачу сразу в эту группу (с соответствующим сроком). */}
                <GroupAdd
                  placeholder={g.placeholder}
                  key={g.key}
                  dueEpochDay={g.key === "week" ? today + 7 : g.key === "month" ? today + 30 : null}
                  onChange={onChange}
                />
              </>
            )}
          </div>
        );
      })}
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
  const [value, setValue] = useState("");
  const add = async () => {
    const t = value.trim();
    if (!t) return;
    await api.upsertTask({ title: t, date: 0, someday: true, dueEpochDay });
    setValue("");
    onChange();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="done"
        placeholder={placeholder}
        style={{
          width: "100%",
          border: "none",
          padding: "4px 8px",
          fontSize: 12,
          background: "transparent",
          outline: "none",
          color: COLORS.text,
        }}
      />
    </form>
  );
}
