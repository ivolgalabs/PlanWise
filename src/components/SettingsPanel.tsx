import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
// Файловый ввод-вывод: на Android системные диалоги возвращают content://,
// который std::fs не читает — плагин fs умеет работать с такими URI.
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../store";
import {
  COLORS, THEME_FAMILIES, argbToHex, hexToArgb,
  ACCENTS, LIGHT_SHADES, DARK_SHADES, hslToHex, hexToHue, autoSlotFor,
  applyCustomSlot,
} from "../theme";
import type { CustomSlot, ThemePreset } from "../theme";
import type { ThemeMode, VisibilityState, SortMode, TaskPattern } from "../store";
import { DEFAULT_VISIBILITY } from "../store";
import { parseTimeToMinutes, formatMinutes } from "../date";
import { api, isTauri } from "../api";
import { useMediaQuery } from "../useMediaQuery";
import { Icon, type IconName } from "./Icon";
import { TimePicker, DurationSelect } from "./TimePicker";
import "./SettingsPanel.css";

/** Приоритет шаблона: 0 = не задан, 1 = низкий, 2 = средний, 3 = высокий. */
const PATTERN_PRIO = [
  { v: 0, label: "—", color: "" },
  { v: 1, label: "низкий", color: "#4caf50" },
  { v: 2, label: "средний", color: "#ffb300" },
  { v: 3, label: "высокий", color: "#e05252" },
];
/** Варианты уведомления шаблона (как в карточке задачи). */
const PATTERN_NOTIFY: { v: number; label: string }[] = [
  { v: -1, label: "По умолчанию (из настроек)" },
  { v: 0, label: "Не уведомлять" },
  { v: 15, label: "За 15 минут" },
  { v: 30, label: "За 30 минут" },
  { v: 60, label: "За 1 час" },
  { v: 120, label: "За 2 часа" },
  { v: 1440, label: "За 1 день" },
];
/** Быстрая палитра цветов категории + свой цвет системным пикером. */
const CAT_PALETTE = [
  "#e05252", "#f0a030", "#f5d547", "#9ccc65",
  "#4caf50", "#26a69a", "#5b8def", "#4a76d9",
  "#9b6de8", "#e07fb4", "#8a8a8a", "#795548",
];

/** Человекочитаемая подпись интервала напоминания: 90 → «1 ч 30 мин»,
 *  10080 → «за 7 дн». Используется в чипах своих интервалов напоминаний. */
function fmtRemindInterval(m: number): string {
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (m >= 1440) {
    const d = Math.floor(m / 1440);
    const restH = Math.floor((m % 1440) / 60);
    return d >= 1 && restH === 0 ? `за ${d} дн` : `за ${d} дн ${restH} ч`;
  }
  return mm === 0 ? `${h} ч` : `${h} ч ${mm} мин`;
}

// Кодирование TMT-кода (канон UUI): TMT-<тема с _ вместо ->-<accent>-<bgType L/O/D/T>-<bgHex>-<slot L/D/N>
function encodePresetCode(p: ThemePreset): string {
  const theme = p.theme.replace(/-/g, "_");
  const accent = (p.accent || "none").replace("#", "");
  const bgType = p.bgMode === "light" ? "L" : p.bgMode === "oled" ? "O" : p.bgMode === "dark" ? "D" : "T";
  const bgHex = (p.bgColor || "none").replace("#", "");
  const slot = p.slot === "light" ? "L" : p.slot === "dark" ? "D" : "N";
  return `TMT-${theme}-${accent}-${bgType}-${bgHex}-${slot}`;
}

function decodePresetCode(code: string): Omit<ThemePreset, "id" | "name"> | null {
  const parts = code.replace(/^TMT-/, "").split("-");
  if (parts.length < 4) return null;
  const [themeEnc, accent, bgType, bgHex, slotChar] = parts;
  const theme = themeEnc.replace(/_/g, "-");
  if (!/^(light|dark|oled)-/.test(theme)) return null;
  const slot: "light" | "dark" | null = slotChar === "L" ? "light" : slotChar === "D" ? "dark" : null;
  return {
    theme,
    accent: accent && accent !== "none" ? `#${accent}` : null,
    bgMode: bgType === "L" ? "light" : bgType === "O" ? "oled" : bgType === "D" ? "dark" : "theme",
    bgColor: bgHex && bgHex !== "none" ? `#${bgHex}` : null,
    slot,
  };
}

interface Props {
  onClose: () => void;
  /** Перезагрузить категории после правок (App обновляет store.colorSets). */
  onSetsChanged: () => void;
  /** Перезагрузить задачи после импорта (App обновляет store.tasks). */
  onTasksChanged: () => void;
  /** Сброс настроек интерфейса: ширина правой панели живёт в App (не в store). */
  onResetUI?: () => void;
}

const SCALE_PRESETS = [0.7, 0.85, 1.0, 1.25, 1.5, 1.75, 2.0];
const FONT_PRESETS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6];

/** Черновик категории для редактирования (id "" = ещё не создана).
 *  clientKey — уникальный ключ строки (crypto.randomUUID): у несохранённых
 *  черновиков id совпадает (""), поэтому React-key и патчи идут по clientKey. */
interface SetDraft {
  id: string;
  clientKey: string;
  name: string;
  color: number;
}

/**
 * Полноценное окно настроек: Оформление (тема свотчами + режим +
 * OLED + масштаб ползунком), Неделя и Категории (цвет-сеты).
 */
export function SettingsPanel({ onClose, onSetsChanged, onTasksChanged, onResetUI }: Props) {
  const {
    view,
    mondayFirst,
    weekVertical,
    themeMode,
    preferredLightTheme,
    preferredDarkTheme,
    useOledForDarkMode,
    customLight,
    customDark,
    presets,
    uiScale,
    fontScale,
    archiveEnabled,
    colorSets,
    visibility,
    panelGap,
    toggleMondayFirst,
    setThemeMode,
    setPreferredLightTheme,
    setPreferredDarkTheme,
    setUseOledForDarkMode,
    setCustomLight,
    setCustomDark,
    setPresets,
    setWeekVertical,
    setUiScale,
    setFontScale,
    setArchiveEnabled,
    setVisibility,
    setPanelGap,
    notifyDaySummary,
    notifyDayHour,
    notifyReminders,
    notifyRemindMinutes,
    setNotifyDaySummary,
    setNotifyDayHour,
    setNotifyReminders,
    setNotifyRemindMinutes,
    timePresets,
    toggleTimePreset,
    taskPatterns,
    setTaskPatterns,
    sortMode,
    setSortMode,
    preventOverlaps,
    setPreventOverlaps,
    autoDonePastTime,
    setAutoDonePastTime,
  } = useStore();

  // ── Черновики категорий для редактирования (служебный cs-none скрыт).
  const [drafts, setDrafts] = useState<SetDraft[]>(() =>
    colorSets
      .filter((s) => s.id !== "cs-none")
      .map((s) => ({ id: s.id, clientKey: crypto.randomUUID(), name: s.name, color: s.color })),
  );

  // ── Черновики шаблонов задач (clientKey — как у категорий: у несохранённых
  //     id пустой, React-ключ и патчи идут по clientKey).
  const [patternDrafts, setPatternDrafts] = useState<(TaskPattern & { clientKey: string })[]>(
    () => taskPatterns.map((p) => ({ ...p, clientKey: crypto.randomUUID() })),
  );
  useEffect(() => {
    // Дозаполняем черновики, если шаблоны пришли позже загрузки настроек.
    if (patternDrafts.length === 0 && taskPatterns.length > 0) {
      setPatternDrafts(taskPatterns.map((p) => ({ ...p, clientKey: crypto.randomUUID() })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskPatterns]);

  const [patternModal, setPatternModal] = useState<(TaskPattern & { clientKey: string }) | null>(null);
  const patchPatternModal = (patch: Partial<TaskPattern>) =>
    setPatternModal((m) => (m ? { ...m, ...patch } : m));
  const openPatternModal = (d?: TaskPattern & { clientKey: string }) => {
    const draft = d ?? {
      id: "",
      clientKey: crypto.randomUUID(),
      title: "",
      timeMinutes: null,
      difficulty: 0,
      durationMinutes: null,
      notifyMinutes: null,
    };
    if (!d) setPatternDrafts((ds) => [...ds, draft]);
    setPatternModal(draft);
  };

  const savePatternDraft = (d: TaskPattern & { clientKey: string }) => {
    const pat: TaskPattern = {
      id: d.id || crypto.randomUUID(),
      title: d.title.trim() || "Без названия",
      timeMinutes: d.timeMinutes,
      difficulty: d.difficulty,
      durationMinutes: d.durationMinutes,
      notifyMinutes: d.notifyMinutes ?? null,
    };
    setTaskPatterns([...taskPatterns.filter((p) => p.id !== pat.id), pat]);
    // Черновик обновляем или добавляем (для нового шаблона), чтобы он
    // сразу появился в списке.
    setPatternDrafts((ds) =>
      ds.some((x) => x.clientKey === d.clientKey)
        ? ds.map((x) => (x.clientKey === d.clientKey ? { ...x, id: pat.id, title: pat.title } : x))
        : [...ds, { ...d, id: pat.id, title: pat.title }],
    );
    setPatternModal(null);
  };

  const removePatternDraft = (d: TaskPattern & { clientKey: string }) => {
    setTaskPatterns(taskPatterns.filter((p) => p.id !== d.id));
    setPatternDrafts((ds) => ds.filter((x) => x.clientKey !== d.clientKey));
    setPatternModal((m) => (m?.clientKey === d.clientKey ? null : m));
  };

  // Быстрое время: новый пресет из системного input type=time.
  const [newPreset, setNewPreset] = useState("");
  const addPreset = () => {
    const m = parseTimeToMinutes(newPreset);
    if (m == null) return;
    toggleTimePreset(m);
    setNewPreset("");
  };

  // Запрет наложений хранится в БД (таблица settings) — сервер проверяет
  // пересечения при каждом сохранении; фронт только переключает настройку.
  const setPrevent = async (v: boolean) => {
    setPreventOverlaps(v);
    try {
      await api.setSetting("prevent_overlaps", v ? "1" : "0");
    } catch {
      /* настройка остаётся в store; сервер вернётся к дефолту (запрещать) */
    }
  };

  // ── Вкладки: контент одной секции вместо длинного скролла всех сразу. ──
  const TABS: [string, string][] = [
    ["appearance", "Оформление"],
    ["tasks", "Задачи"],
    ["time", "Время"],
    ["notify", "Уведомления"],
    ["interface", "Интерфейс"],
    ["categories", "Категории"],
    ["data", "Данные"],
  ];
  const [settingsTab, setSettingsTab] = useState("appearance");
  const bodyRef = useRef<HTMLDivElement>(null);
  // При переключении вкладки — к началу списка настроек.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [settingsTab]);

  // Доступность «десктопных» элементов сейчас, на этом экране. Пункты
  // настроек показываем, только если соответствующая панель/кнопка реально
  // доступна: на тач-экране нет кнопки даты и сетки недели, в узком окне —
  // правой панели с мини-календарём, в «Месяце» мини-календаря нет.
  // Общие listener'ы на запросы — см. useMediaQuery.
  const touchUI = useMediaQuery("(pointer: coarse), (max-width: 560px)");
  const panelNarrow = useMediaQuery(`(max-width: ${view === "day" ? 700 : 1000}px)`);
  const weekNarrow = useMediaQuery("(max-width: 820px)");

  // colorSets грузятся асинхронно — если панель открылась до загрузки,
  // черновики остались пустыми. Дозаполняем их, когда данные пришли
  // (пользователь при этом ещё ничего не создавал).
  useEffect(() => {
    if (drafts.length === 0 && colorSets.some((s) => s.id !== "cs-none")) {
      setDrafts(
        colorSets
          .filter((s) => s.id !== "cs-none")
          .map((s) => ({ id: s.id, clientKey: crypto.randomUUID(), name: s.name, color: s.color })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorSets]);

  const patchDraft = (clientKey: string, patch: Partial<SetDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.clientKey === clientKey ? { ...d, ...patch } : d)));

  const addDraft = () =>
    setDrafts((ds) => [
      ...ds,
      { id: "", clientKey: crypto.randomUUID(), name: "Новая категория", color: hexToArgb("#7eb8c4") },
    ]);

  const saveDraft = async (d: SetDraft) => {
    const saved = await api.upsertColorSet({
      id: d.id || undefined,
      name: d.name.trim() || "Без названия",
      color: d.color,
    });
    // Новая категория получает id от Rust — обновляем черновик, чтобы
    // повторное сохранение не создавало дубль.
    setDrafts((ds) =>
      ds.map((x) => (x.clientKey === d.clientKey ? { ...x, id: saved.id } : x)),
    );
    onSetsChanged();
  };

  const removeDraft = async (d: SetDraft) => {
    if (d.id) {
      await api.deleteColorSet(d.id);
      onSetsChanged();
    }
    setDrafts((ds) => ds.filter((x) => x.clientKey !== d.clientKey));
  };

  // ── Экспорт/импорт данных (JSON-бэкап) ──
  const [dataMsg, setDataMsg] = useState("");
  const [dataError, setDataError] = useState(false);
  // Своё значение интервала напоминания: держим в локальном состоянии, чтобы
  // селекты «ч/мин» показывали выбранное, а не сбрасывались на 0 (раньше
  // value={null} — после выбора всё выглядело «не применённым»).
  const [customRemind, setCustomRemind] = useState<number | null>(null);
  const onExport = async () => {
    // В браузере диалог сохранения недоступен — только в Tauri-приложении.
    if (!isTauri()) {
      setDataError(false);
      setDataMsg("Доступно в приложении");
      return;
    }
    const d = new Date();
    const name = `daily-planner-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    let path: string | null;
    try {
      path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
    } catch (e) { setDataError(true); setDataMsg(String(e)); return; }
    if (!path) return;
    try {
      // Данные отдаёт Rust (export_json); файл пишет плагин fs — на Android
      // это единственный способ записать по content:// из системного диалога.
      const json = await invoke<string>("export_json");
      await writeTextFile(path, json);
      setDataError(false); setDataMsg("Экспортировано ✓");
    } catch (e) { setDataError(true); setDataMsg(String(e)); }
  };
  const onImport = async () => {
    if (!isTauri()) {
      setDataError(false);
      setDataMsg("Доступно в приложении");
      return;
    }
    let path: string | string[] | null;
    try {
      path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
    } catch (e) { setDataError(true); setDataMsg(String(e)); return; }
    if (!path || Array.isArray(path)) return;
    if (!window.confirm("Данные будут ЗАМЕНЕНЫ данными из файла. Продолжить?")) return;
    try {
      // Читаем файл плагином fs (content:// на Android), замену данных
      // выполняет Rust-команда import_json в транзакции (ошибка — откат).
      const json = await readTextFile(path);
      const n = await invoke<number>("import_json", { json });
      setDataError(false); setDataMsg(`Импортировано задач: ${n}`);
      onSetsChanged();
      onTasksChanged();
    } catch (e) { setDataError(true); setDataMsg(String(e)); }
  };

  // ── Оформление: «Свой выбор» (конструктор, как в TensorMedia) ──
  // Текущий тёмный режим (для авто-фона и выбора активного слота).
  const systemIsDark =
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const curDark =
    themeMode === "dark" || (themeMode === "system" && systemIsDark);
  // Разрешённая тема сейчас (дубль логики resolveActiveTheme из App).
  const resolvedTheme =
    themeMode === "light"
      ? preferredLightTheme
      : themeMode === "dark"
        ? useOledForDarkMode
          ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
          : preferredDarkTheme
        : systemIsDark
          ? useOledForDarkMode
            ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-")
            : preferredDarkTheme
          : preferredLightTheme;
  // Активный свотч: тема применена сейчас (без OLED-замены показываем базу).
  const activeBase = resolvedTheme.replace(/^oled-/, "dark-");

  // Черновик «Своего выбора»: применяется вживую; при закрытии сбрасывается.
  const [draft, setDraft] = useState<CustomSlot | null>(() => {
    const cur = curDark ? customDark : customLight;
    return cur ? { ...cur } : null;
  });
  const [hue, setHue] = useState(() => (draft?.accent ? hexToHue(draft.accent) : 0));
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const [presetName, setPresetName] = useState("");
  const [presetSlotSel, setPresetSlotSel] = useState<"auto" | "light" | "dark">("auto");
  const [importCode, setImportCode] = useState("");
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);

  const msg = (text: string, ok = true) => {
    setFlash({ text, ok });
    window.setTimeout(() => setFlash(null), 4000);
  };

  // Сброс настроек интерфейса: видимость элементов, зазор панели, ориентация
  // недели, масштабы. Ширина панели (App) сбрасывается через onResetUI.
  const resetInterface = () => {
    (Object.keys(DEFAULT_VISIBILITY) as (keyof VisibilityState)[]).forEach((k) =>
      setVisibility(k, DEFAULT_VISIBILITY[k]),
    );
    setPanelGap(20);
    setWeekVertical(true);
    setUiScale(1);
    setFontScale(1);
    if (!mondayFirst) toggleMondayFirst();
    onResetUI?.();
    msg("Настройки интерфейса сброшены к умолчаниям");
  };

  // Применяем черновик (или активный слот) поверх темы вживую.
  useEffect(() => {
    applyCustomSlot(document.documentElement, draft ?? (curDark ? customDark : customLight), curDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, customLight, customDark, themeMode]);

  // Закрытие: сбрасываем черновик (возвращаем активный слот из хранилища).
  const close = () => {
    applyCustomSlot(document.documentElement, curDark ? customDark : customLight, curDark);
    onClose();
  };

  const handleSetMode = (m: ThemeMode) => {
    setThemeMode(m);
    const isD = m === "dark" || (m === "system" && systemIsDark);
    const cur = isD ? customDark : customLight;
    setDraft(cur ? { ...cur } : null);
  };

  // Свотч стандартной темы: применяет и очищает слот своего стиля.
  const handleSwatch = (id: string) => {
    if (id.startsWith("light-")) {
      setPreferredLightTheme(id);
      setThemeMode("light");
      setCustomLight(null);
    } else {
      setPreferredDarkTheme(id);
      setThemeMode("dark");
      setCustomDark(null);
    }
    setDraft(null);
  };

  // Конструктор: акцент / фон. (patchDraft — у черновиков категорий выше.)
  const patchSlot = (patch: Partial<CustomSlot>) => {
    setDraft({
      name: draft?.name || "Мой стиль",
      accent: draft?.accent ?? null,
      bgType: draft?.bgType ?? "auto",
      bgColor: draft?.bgColor ?? null,
      ...patch,
    });
  };
  const handleAccent = (accent: string) => patchSlot({ accent });
  const handleBgMode = (bgMode: "theme" | "light" | "dark" | "oled") => {
    if (bgMode === "theme") {
      setDraft(draft?.accent ? { name: draft.name, accent: draft.accent, bgType: "auto", bgColor: null } : null);
    } else {
      patchSlot({ bgType: bgMode });
    }
  };
  const handleBgShade = (c: string) => {
    const bgType = LIGHT_SHADES.includes(c) ? "light" : c === "#000000" ? "oled" : "dark";
    patchSlot({ bgType, bgColor: c });
  };

  // ── Библиотека «Мои стили» ──
  const savePreset = () => {
    let name = presetName.trim();
    if (!name) {
      let n = 1;
      while (presets.some((p) => p.name === `Стиль #${n}`)) n++;
      name = `Стиль #${n}`;
    }
    if (presets.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      msg(`Стиль «${name}» уже есть`, false);
      return;
    }
    const slot = presetSlotSel === "auto"
      ? autoSlotFor({ bgColor: draft?.bgColor || null, bgMode: draft?.bgType || "theme", theme: resolvedTheme })
      : presetSlotSel;
    const preset: ThemePreset = {
      id: Math.random().toString(36).slice(2, 9),
      name,
      theme: resolvedTheme,
      accent: draft?.accent || null,
      bgMode: draft?.bgColor ? (draft.bgType === "light" ? "light" : draft.bgType === "oled" ? "oled" : "dark") : "theme",
      bgColor: draft?.bgColor || null,
      slot,
    };
    setPresets([...presets, preset]);
    setPresetName("");
    msg(slot === "light" ? "Сохранено в слот ☀️" : "Сохранено в слот 🌙");
  };

  const applyPreset = (p: ThemePreset) => {
    if (p.theme.startsWith("light-")) setPreferredLightTheme(p.theme);
    else if (p.theme.startsWith("oled-")) {
      setPreferredDarkTheme(p.theme.replace("oled-", "dark-"));
      setUseOledForDarkMode(true);
    } else setPreferredDarkTheme(p.theme);
    const slot = p.slot || autoSlotFor({ bgColor: p.bgColor, bgMode: p.bgMode, theme: p.theme });
    const slotData: CustomSlot = { name: p.name, accent: p.accent, bgType: p.bgMode === "theme" ? "auto" : p.bgMode, bgColor: p.bgColor };
    if (slot === "light") setCustomLight(slotData);
    else setCustomDark(slotData);
    setThemeMode(slot === "light" ? "light" : "dark");
    setDraft(null);
    msg(`Применён стиль «${p.name}»`);
  };

  const copyPresetCode = (p: ThemePreset) => {
    const code = encodePresetCode(p);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).catch(() => {});
    setImportCode(code);
    msg(`Код скопирован: ${code}`);
  };

  const importPreset = () => {
    const p = decodePresetCode(importCode.trim());
    if (!p) { msg("Неверный формат кода", false); return; }
    setPresets([
      ...presets,
      { ...p, id: Math.random().toString(36).slice(2, 9), name: `Импорт ${p.theme}` },
    ]);
    setImportCode("");
    msg("Стиль импортирован");
  };

  const clearSlot = (kind: "light" | "dark") => {
    if (kind === "light") setCustomLight(null);
    else setCustomDark(null);
    if (curDark === (kind === "dark")) setDraft(null);
  };

  const modes: { mode: ThemeMode; icon: IconName; label: string }[] = [
    { mode: "light", icon: "sun", label: "Светлая" },
    { mode: "dark", icon: "moon", label: "Тёмная" },
    { mode: "system", icon: "monitor", label: "Системная" },
  ];

  return (
    <div className="settings-overlay" onClick={close}>
      <div className="settings-window" onClick={(e) => e.stopPropagation()}>
        {/* Шапка */}
        <div className="settings-header">
          <h2
            className="settings-title"
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
          >
            <Icon name="gear" size={18} /> Настройки
          </h2>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="settings-body" ref={bodyRef}>
          {/* Вкладки: настройки разбиты по группам, чтобы не листать
              длинный список — на мобиле лента скроллится горизонтально. */}
          <div className="settings-tabs">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                className={`settings-tab ${settingsTab === id ? "active" : ""}`}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Оформление ── */}
          {settingsTab === "appearance" && (
          <>
          {/* ── Масштаб ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3
                  className="section-title"
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                >
                  <Icon name="zoom" size={14} /> Масштаб интерфейса
                </h3>
                <p className="section-hint">От 70% до 200% — применяется ко всем элементам</p>
              </div>
              <span className="scale-badge">{Math.round(uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.7}
              max={2.0}
              step={0.05}
              value={uiScale}
              onChange={(e) => setUiScale(parseFloat(e.target.value))}
              className="scale-slider"
            />
            <div className="scale-marks">
              <span>70%</span>
              <span>100%</span>
              <span>150%</span>
              <span>200%</span>
            </div>
            <div className="scale-presets">
              {SCALE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setUiScale(s)}
                  className={`preset-btn ${Math.abs(uiScale - s) < 0.01 ? "active" : ""}`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </section>

          {/* ── Размер шрифта ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Размер шрифта</h3>
                <p className="section-hint">Меняет только текст, без масштабирования всего интерфейса</p>
              </div>
              <span className="scale-badge">{Math.round(fontScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.8}
              max={1.6}
              step={0.05}
              value={fontScale}
              onChange={(e) => setFontScale(parseFloat(e.target.value))}
              className="scale-slider"
            />
            <div className="scale-marks">
              <span>80%</span>
              <span>100%</span>
              <span>130%</span>
              <span>160%</span>
            </div>
            <div className="scale-presets">
              {FONT_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setFontScale(s)}
                  className={`preset-btn ${Math.abs(fontScale - s) < 0.01 ? "active" : ""}`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </section>

          {/* ── Оформление: статус + вкладки (стандартные / свой выбор) ── */}
          <section className="settings-section">
            <div className="theme-status">
              <div className="theme-status-head">
                <div>
                  <h3 className="theme-status-title">Оформление</h3>
                  <p className="theme-status-subtitle">
                    Активная тема: <strong>{resolvedTheme}</strong>
                  </p>
                </div>
                <div className="theme-status-modes">
                  {modes.map((m) => (
                    <button
                      key={m.mode}
                      className={`theme-status-mode-btn ${themeMode === m.mode ? "active" : ""}`}
                      onClick={() => handleSetMode(m.mode)}
                    >
                      <Icon name={m.icon} size={13} /> {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="theme-status-grid">
                <div className="theme-status-pref">
                  <div>
                    <span className="theme-status-pref-label">Светлая:</span>
                    <span className="theme-status-pref-value">
                      {customLight ? customLight.name : preferredLightTheme}
                    </span>
                  </div>
                  <span className={`theme-status-tag ${curDark ? "saved" : "active"}`}>
                    {curDark ? "сохранена" : "✓ активна"}
                  </span>
                </div>
                <div className="theme-status-pref">
                  <div>
                    <span className="theme-status-pref-label">Тёмная:</span>
                    <span className="theme-status-pref-value">
                      {customDark ? customDark.name : useOledForDarkMode ? preferredDarkTheme.replace(/^(dark|light)-/, "oled-") : preferredDarkTheme}
                      {!customDark && useOledForDarkMode && <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-2xs)" }}> (OLED)</span>}
                    </span>
                  </div>
                  <span className={`theme-status-tag ${curDark ? "active" : "saved"}`}>
                    {curDark ? "✓ активна" : "сохранена"}
                  </span>
                </div>
              </div>
            </div>

            {/* Вкладки: Стандартные / Свой выбор */}
            <div className="theme-tabs">
              <button className={`theme-tab-btn ${tab === "standard" ? "active" : ""}`} onClick={() => setTab("standard")}>
                Стандартные
              </button>
              <button className={`theme-tab-btn ${tab === "custom" ? "active" : ""}`} onClick={() => setTab("custom")}>
                Свой выбор
              </button>
            </div>

            {/* ── Вкладка 1: Стандартные (OLED — галочкой) ── */}
            {tab === "standard" && (
              <div className="theme-tab-panel">
                <div className="theme-status-oled">
                  <div>
                    <h4 className="theme-status-oled-title">OLED (True Black)</h4>
                    <p className="theme-status-oled-desc">
                      Чистый чёрный фон для тёмного режима
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={useOledForDarkMode}
                      onChange={(e) => setUseOledForDarkMode(e.target.checked)}
                    />
                    <span className="switch-track"></span>
                  </label>
                </div>
                {THEME_FAMILIES.map((f) => (
                  <div className="theme-family" key={f.family}>
                    <h4 className="theme-family-label">
                      <span className="theme-family-dot" style={{ background: f.accent }} />
                      {f.label}
                    </h4>
                    <div className="theme-swatches">
                      {f.modes
                        .filter((m) => !m.id.startsWith("oled-"))
                        .map((m) => {
                          const isLight = m.id.startsWith("light-");
                          const active = isLight
                            ? preferredLightTheme === m.id
                            : activeBase === m.id;
                          return (
                            <button
                              key={m.id}
                              className={`theme-swatch ${active ? "active" : ""}`}
                              style={{ background: m.bg, color: m.text }}
                              onClick={() => handleSwatch(m.id)}
                              title={`${f.label} · ${m.name}`}
                            >
                              <span className="theme-swatch-colors">
                                <span style={{ background: m.bg }} />
                                <span style={{ background: f.accent }} />
                                <span style={{ background: m.text }} />
                              </span>
                              <span className="theme-swatch-name">{m.name}</span>
                              {active && <span className="theme-swatch-check">✓</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Вкладка 2: Свой выбор (конструктор) ── */}
            {tab === "custom" && (
              <div className="theme-tab-panel">
                <p className="pv-note">
                  Свой акцент и фон — поверх выбранной темы. Применяется сразу;
                  сохраните в «Мои стили», чтобы не потерять.
                </p>
                <div className="pv-grid">
                  <div className="pv-card">
                    <h3>Акцент</h3>
                    <div className="designer-colors-grid">
                      {ACCENTS.map((c) => (
                        <button
                          key={c}
                          className={`color-dot-btn ${draft?.accent === c ? "active" : ""}`}
                          style={{ background: c }}
                          title={c}
                          onClick={() => handleAccent(c)}
                        />
                      ))}
                    </div>
                    <div className="slider-header-row">
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-secondary)" }}>Оттенок</span>
                      <span className="hue-value-indicator">{draft?.accent ? hslToHex(hue, 85, 55) : "—"}</span>
                    </div>
                    <div className="rainbow-slider-container">
                      <input
                        type="range" min={0} max={360} value={hue}
                        className="rainbow-hue-slider"
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          setHue(v);
                          handleAccent(hslToHex(v, 85, 55));
                        }}
                      />
                    </div>
                    <div className="designer-actions-row">
                      <button
                        className="reset-accent-btn"
                        onClick={() => setDraft(draft?.bgColor ? { ...draft, accent: null } : null)}
                      >
                        Сбросить акцент
                      </button>
                      <span className="pv-hint">
                        {draft?.accent ? `Свой акцент: ${draft.accent}` : "Акцент — из темы"}
                      </span>
                    </div>
                  </div>

                  <div className="pv-card">
                    <h3>Фон</h3>
                    <div className="pv-bg-row">
                      {([["theme", "Из темы"], ["light", "Светлый"], ["dark", "Тёмный"], ["oled", "OLED"]] as const).map(([v, label]) => (
                        <button
                          key={v}
                          className={`pv-bg-btn ${(draft?.bgColor || draft?.accent) && draft?.bgType === v ? "active" : (!draft && v === "theme" ? "active" : "")}`}
                          onClick={() => handleBgMode(v)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", display: draft?.bgType === "oled" ? "none" : "" }}>
                      Оттенки:
                    </div>
                    <div className="bg-preset-shades" style={{ display: draft?.bgType === "oled" ? "none" : "" }}>
                      {(draft?.bgType === "light" ? LIGHT_SHADES : DARK_SHADES).map((c) => (
                        <button
                          key={c}
                          className={`bg-shade-btn ${draft?.bgColor === c ? "active" : ""}`}
                          style={{ background: c }}
                          title={c}
                          onClick={() => handleBgShade(c)}
                        />
                      ))}
                    </div>
                    <p className="pv-note">
                      {draft?.bgType === "oled" ? "OLED — чистый чёрный, без оттенков." : "Выберите оттенок фона."}
                    </p>
                  </div>
                </div>

                <div className="pv-card">
                  <h3>Мои стили</h3>
                  <p className="preset-actions-hint">Слоты ☀️/🌙 заполняются при «Применить» из библиотеки</p>
                  <div className="slot-rows">
                    {(["light", "dark"] as const).map((kind) => {
                      const slot = kind === "light" ? customLight : customDark;
                      const isCur = curDark === (kind === "dark");
                      return (
                        <div className="preset-item-row" key={kind}>
                          <div className="preset-item-info">
                            <span
                              className="preset-preview-circle"
                              style={{ background: slot?.bgColor || (kind === "light" ? "#f4f0ec" : "#0f0f15") }}
                            >
                              <span className="preset-preview-dot" style={{ background: slot?.accent || "#4c5699" }} />
                            </span>
                            <span className="preset-item-name">
                              {kind === "light" ? "☀️ " : "🌙 "}Слот: {slot ? slot.name : "—"}
                            </span>
                          </div>
                          <div className="preset-item-actions">
                            {slot && (
                              <>
                                <span className={`theme-status-tag ${isCur && slot ? "active" : "saved"}`}>
                                  {isCur && slot ? "✓ применён" : "сохранён"}
                                </span>
                                <button
                                  className="preset-action-btn delete"
                                  title="Очистить слот"
                                  onClick={() => clearSlot(kind)}
                                >
                                  <Icon name="close" size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="preset-actions-hint">Библиотека — сохранить, применить, скопировать код</p>
                  <div className="presets-list">
                    {presets.length === 0 && <p className="no-presets-text">Своих стилей пока нет.</p>}
                    {presets.map((p) => {
                      const applied = p.slot && ((p.slot === "light" ? customLight : customDark)?.name === p.name);
                      return (
                        <div className="preset-item-row" key={p.id}>
                          <div className="preset-item-info" title="Применить" onClick={() => applyPreset(p)}>
                            <span className="preset-preview-circle" style={{ background: p.bgColor || "#f4f0ec" }}>
                              <span className="preset-preview-dot" style={{ background: p.accent || "#4c5699" }} />
                            </span>
                            <span className="preset-item-name">{p.name}</span>
                          </div>
                          <div className="preset-item-actions">
                            <button className={`preset-action-btn apply ${applied ? "active" : ""}`} onClick={() => applyPreset(p)}>
                              {applied ? "✓ применён" : "Применить"}
                            </button>
                            <button className="preset-action-btn" title="Скопировать TMT-код" onClick={() => copyPresetCode(p)}>
                              <Icon name="copy" size={12} />
                            </button>
                            <button
                              className="preset-action-btn delete"
                              title="Удалить"
                              onClick={() => setPresets(presets.filter((x) => x.id !== p.id))}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="save-preset-form">
                    <input
                      type="text"
                      className="preset-name-input"
                      value={presetName}
                      placeholder="Имя стиля"
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <select
                      className="preset-slot-select"
                      value={presetSlotSel}
                      onChange={(e) => setPresetSlotSel(e.target.value as typeof presetSlotSel)}
                      title="Слот"
                    >
                      <option value="auto">Авто</option>
                      <option value="light">☀️ Светлый</option>
                      <option value="dark">🌙 Тёмный</option>
                    </select>
                    <button className="save-preset-btn" onClick={savePreset}>
                      Сохранить
                    </button>
                  </div>
                  <div className="import-preset-form">
                    <div className="import-input-wrap">
                      <input
                        type="text"
                        className="preset-import-input"
                        value={importCode}
                        placeholder="TMT-код для импорта"
                        onChange={(e) => setImportCode(e.target.value)}
                      />
                      <button className="import-preset-btn" onClick={importPreset}>
                        Импорт
                      </button>
                    </div>
                    {flash && (
                      <span className="import-error-msg" style={{ color: flash.ok ? "var(--success)" : "var(--danger)" }}>
                        {flash.text}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── Задачи ── */}
          </>)}
          {settingsTab === "tasks" && (
          <>
          {/* ── Неделя ── */}
          <section className="settings-section">
            <h3 className="section-title">Неделя</h3>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={mondayFirst}
                onChange={toggleMondayFirst}
              />
              <span>Начинается с понедельника</span>
            </label>
            {/* На тач-экранах и в узком окне неделя всегда списком (narrow-режим),
                поэтому выбор «Списком/Сеткой» показываем только там, где сетка
                реально доступна. */}
            {!touchUI && !weekNarrow && (
              <>
                <p className="section-hint" style={{ margin: "var(--sp-2) 0 var(--sp-1)" }}>
                  Открывать неделю по умолчанию:
                </p>
                <div className="theme-status-modes">
                  <button
                    className={`theme-status-mode-btn ${weekVertical ? "active" : ""}`}
                    onClick={() => setWeekVertical(true)}
                  >
                    Списком
                  </button>
                  <button
                    className={`theme-status-mode-btn ${!weekVertical ? "active" : ""}`}
                    onClick={() => setWeekVertical(false)}
                  >
                    Сеткой
                  </button>
                </div>
              </>
            )}
          </section>

          {/* ── Задачи ── */}
          <section className="settings-section">
            <h3 className="section-title">Задачи</h3>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={archiveEnabled}
                onChange={(e) => setArchiveEnabled(e.target.checked)}
              />
              <span>Авто-архив просроченных задач</span>
            </label>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={preventOverlaps}
                onChange={(e) => setPrevent(e.target.checked)}
              />
              <span>Запрещать задачи на одно время</span>
            </label>
            <p className="section-hint">
              Не даёт поставить задачу на время, занятое другой (можно добавить
              как подзадачу). Наложения у старых задач подсвечиваются красным.
            </p>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={autoDonePastTime}
                onChange={(e) => setAutoDonePastTime(e.target.checked)}
              />
              <span>Прошедшее время = задача выполнена</span>
            </label>
            <p className="section-hint">
              При установке времени: если оно уже прошло — задача автоматически
              выполненная; время в будущем — снимает выполнение.
            </p>
            <p className="section-hint" style={{ margin: "var(--sp-2) 0 var(--sp-1)" }}>
              Сортировка задач в дне/неделе/месяце:
            </p>
            <div className="theme-status-modes">
              {(
                [
                  ["time", "По времени"],
                  ["manual", "Вручную"],
                  ["priority", "По приоритету"],
                ] as [SortMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  className={`theme-status-mode-btn ${sortMode === m ? "active" : ""}`}
                  onClick={() => setSortMode(m)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="section-hint">«По приоритету» — высокие задачи сначала</p>
          </section>

          {/* ── Время ── */}
          </>)}
          {settingsTab === "time" && (
          <>
          {/* ── Быстрое время ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Быстрое время</h3>
                <p className="section-hint">
                  Кнопки быстрого выбора времени в карточке задачи (свой список)
                </p>
              </div>
            </div>
            {timePresets.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                {timePresets.map((m) => (
                  <span key={m} className="preset-chip">
                    {formatMinutes(m)}
                    <button
                      className="preset-chip-x"
                      onClick={() => toggleTimePreset(m)}
                      title="Убрать"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {timePresets.length === 0 && (
              <p className="section-hint">Список пуст — добавьте свои варианты времени.</p>
            )}
            <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
              <input
                type="time"
                value={newPreset}
                onChange={(e) => setNewPreset(e.target.value)}
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  color: "var(--text-primary)",
                  fontSize: "var(--fs-xs)",
                }}
                title="Свое время — системные часы"
              />
              <button className="preset-btn" onClick={addPreset} title="Добавить время">
                Добавить
              </button>
            </div>
          </section>

          {/* ── Шаблоны задач ── */}
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Шаблоны задач</h3>
                <p className="section-hint">
                  Кнопка «+ Шаблон» в дне/неделе создаёт задачу с этими параметрами
                </p>
              </div>
              <button
                className="preset-btn"
                onClick={() => openPatternModal()}
                style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
              >
                <Icon name="plus" size={14} /> Добавить
              </button>
            </div>
            <div className="set-list">
              {patternDrafts.map((d) => (
                <div key={d.clientKey} className="set-row" style={{ justifyContent: "space-between" }}>
                  <button
                    className="set-name"
                    onClick={() => openPatternModal(d)}
                    title="Изменить шаблон"
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--sp-2)",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{d.title || "Без названия"}</span>
                    <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>
                      {d.timeMinutes != null ? `${formatMinutes(d.timeMinutes)} · ` : ""}
                      {d.durationMinutes ? `${d.durationMinutes} мин` : "без длительности"}
                      {d.notifyMinutes != null ? ` · напом. за ${d.notifyMinutes} мин` : ""}
                    </span>
                  </button>
                  <button
                    className="preset-btn danger"
                    onClick={() => removePatternDraft(d)}
                    title="Удалить шаблон"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              {patternDrafts.length === 0 && (
                <p className="section-hint">Шаблонов пока нет — добавьте первый.</p>
              )}
            </div>
          </section>

          {/* ── Уведомления ── */}
          </>)}
          {settingsTab === "notify" && (
          <>
          <section className="settings-section">
            <h3 className="section-title">Уведомления</h3>
            <p className="section-hint">Приходят, пока приложение работает (в т.ч. в фоне)</p>
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={notifyDaySummary}
                onChange={(e) => setNotifyDaySummary(e.target.checked)}
              />
              <span>Список задач на день — утром</span>
            </label>
            {notifyDaySummary && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "0 0 var(--sp-2)" }}>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)" }}>Время:</span>
                {/* Час дайджеста — системными часами (любое время суток). */}
                <input
                  type="time"
                  value={`${String(notifyDayHour).padStart(2, "0")}:00`}
                  onChange={(e) => {
                    const m = parseTimeToMinutes(e.target.value);
                    if (m != null) setNotifyDayHour(Math.floor(m / 60));
                  }}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "var(--text-primary)",
                    fontSize: "var(--fs-xs)",
                  }}
                />
              </div>
            )}
            <label className="oled-toggle">
              <input
                type="checkbox"
                checked={notifyReminders}
                onChange={(e) => setNotifyReminders(e.target.checked)}
              />
              <span>Напоминания перед задачами со временем</span>
            </label>
            {notifyReminders && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)", padding: "0 0 var(--sp-2)", alignItems: "center" }}>
                {/* Мультиселект: можно выбрать несколько интервалов сразу
                    (например, за час И за день) — каждое уведомление придёт.
                    Нажатие на активную кнопку убирает интервал. */}
                {[15, 30, 60, 120, 1440].map((m) => (
                  <button
                    key={m}
                    className={`preset-btn ${notifyRemindMinutes.includes(m) ? "active" : ""}`}
                    onClick={() => setNotifyRemindMinutes(m)}
                    title={notifyRemindMinutes.includes(m) ? "Убрать этот интервал" : "Добавить этот интервал"}
                  >
                    {m < 60 ? `${m} мин` : m === 60 ? "1 час" : m === 120 ? "2 часа" : "за день"}
                  </button>
                ))}
                {/* Свои интервалы — такие же кнопки с ×: видно, что добавлено,
                    и можно убрать. Раньше свои значения не показывались и
                    «повисали» без возможности снять. */}
                {notifyRemindMinutes
                  .filter((m) => ![15, 30, 60, 120, 1440].includes(m))
                  .map((m) => (
                    <button
                      key={m}
                      className="preset-btn active"
                      onClick={() => setNotifyRemindMinutes(m)}
                      title="Убрать этот интервал"
                    >
                      {fmtRemindInterval(m)} ×
                    </button>
                  ))}
                {/* Своё значение — КОЛИЧЕСТВО времени до начала (селекты
                    «ч»/«мин»). Селекты помнят выбранное (local state), выбор
                    ДОБАВЛЯЕТ интервал (не переключает — иначе повторный выбор
                    того же значения молча его убирал). */}
                <DurationSelect
                  value={customRemind}
                  onChange={(m) => {
                    setCustomRemind(m);
                    if (m != null && m > 0 && !notifyRemindMinutes.includes(m)) {
                      setNotifyRemindMinutes(m);
                    }
                  }}
                  maxHours={168}
                />
                <span style={{ fontSize: "var(--fs-2xs)", color: "var(--text-muted)" }}>
                  введите ч/мин и нажмите «ОК»
                </span>
              </div>
            )}
            <p className="section-hint" style={{ marginTop: "var(--sp-2)" }}>
              Для отдельной задачи можно задать своё напоминание: нажмите на задачу
              и выберите «Уведомить» (по умолчанию / не уведомлять / за N минут).
              Подзадачи напоминают вместе со своей задачей.
            </p>
          </section>

          {/* ── Интерфейс ── */}
          </>)}
          {settingsTab === "interface" && (
          <>
          <section className="settings-section">
            <h3 className="section-title">Интерфейс</h3>
            <p className="section-hint">Скрытые элементы можно вернуть здесь же</p>
            {/* Пункты показываем, только если элемент реально есть на экране:
                кнопка даты скрыта на тач-экранах, правая панель с мини-
                календарём — в узком окне и в «Месяце»; сетка недели — только
                на широких экранах. В десктопном виде на телефоне пункты
                появляются. */}
            {!touchUI && (
              <label className="oled-toggle">
                <input type="checkbox" checked={visibility.datePicker} onChange={(e) => setVisibility("datePicker", e.target.checked)} />
                <span>Кнопка даты (заголовок-дата остаётся)</span>
              </label>
            )}
            {!panelNarrow && view !== "month" && (
              <label className="oled-toggle">
                <input type="checkbox" checked={visibility.miniCalendar} onChange={(e) => setVisibility("miniCalendar", e.target.checked)} />
                <span>Мини-календарь справа</span>
              </label>
            )}
            {([
              ["navArrows", "Стрелки навигации ‹ ›"],
              ["search", "Кнопка поиска"],
              ["taskTime", "Время задач"],
              ["subtasks", "Подзадачи"],
              ["notes", "Заметки"],
              ["someday", "«Когда-нибудь»"],
              ["archiveBanner", "Баннер «Архивировано задач»"],
            ] as [keyof VisibilityState, string][]).map(([k, label]) => (
              <label key={k} className="oled-toggle">
                <input type="checkbox" checked={visibility[k]} onChange={(e) => setVisibility(k, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
            {/* Расстояние между календарём и «Когда-нибудь» — сохраняется
                между запусками; 0 = секции вплотную. Показываем, только если
                правая панель реально есть на экране. */}
            {!panelNarrow && (
              <>
                <div className="section-head" style={{ marginTop: "var(--sp-3)" }}>
                  <div>
                    <h3 className="section-title">Панель справа</h3>
                    <p className="section-hint">Расстояние между календарём и «Когда-нибудь»</p>
                  </div>
                  <span className="scale-badge">{panelGap}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={2}
                  value={panelGap}
                  onChange={(e) => setPanelGap(parseInt(e.target.value, 10))}
                  className="scale-slider"
                />
              </>
            )}
            <button className="preset-btn danger" onClick={resetInterface} style={{ marginTop: "var(--sp-3)" }}>
              Сбросить настройки интерфейса
            </button>
          </section>

          {/* ── Категории (цвет-сеты) ── */}
          </>)}
          {settingsTab === "categories" && (
          <>
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3
                  className="section-title"
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
                >
                  <Icon name="palette" size={14} /> Категории
                </h3>
                <p className="section-hint">Свои названия и цвета для задач; применяются в меню цвета, календаре и поиске</p>
              </div>
              <button
                className="preset-btn"
                onClick={addDraft}
                style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-3)" }}
              >
                <Icon name="plus" size={14} /> Добавить
              </button>
            </div>
            <div className="set-list">
              {drafts.map((d) => (
                <div key={d.clientKey} className="set-row" style={{ alignItems: "flex-start" }}>
                  {/* Быстрая палитра цветов + свой цвет системным пикером. */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 3,
                      maxWidth: 170,
                      paddingTop: 4,
                    }}
                  >
                    {CAT_PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => patchDraft(d.clientKey, { color: hexToArgb(c) })}
                        title="Выбрать цвет"
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: c,
                          cursor: "pointer",
                          border: `2px solid ${argbToHex(d.color) === c ? "var(--text-primary)" : "transparent"}`,
                          padding: 0,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                    <label
                      title="Свой цвет (системный пикер)"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        border: "1px dashed var(--border-color)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "var(--fs-xs)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      <Icon name="plus" size={12} />
                      <input
                        type="color"
                        value={argbToHex(d.color)}
                        onChange={(e) => patchDraft(d.clientKey, { color: hexToArgb(e.target.value) })}
                        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                        title="Свой цвет"
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => patchDraft(d.clientKey, { name: e.target.value })}
                    placeholder="Название категории"
                    className="set-name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveDraft(d);
                    }}
                  />
                  <button
                    className="preset-btn"
                    onClick={() => saveDraft(d)}
                    title="Сохранить"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="save" size={14} />
                  </button>
                  <button
                    className="preset-btn danger"
                    onClick={() => removeDraft(d)}
                    title="Удалить категорию"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              {drafts.length === 0 && (
                <p className="section-hint">Категорий пока нет — добавьте первую.</p>
              )}
            </div>
          </section>

          {/* ── Данные ── */}
          </>)}
          {settingsTab === "data" && (
          <>
          <section className="settings-section">
            <div className="section-head">
              <div>
                <h3 className="section-title">Данные</h3>
                <p className="section-hint">Экспорт — полный бэкап; импорт заменяет текущие данные</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button className="preset-btn" onClick={onExport} title="Сохранить бэкап в файл">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="download" size={14} /> Экспорт…</span>
              </button>
              <button className="preset-btn" onClick={onImport} title="Загрузить данные из файла">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="upload" size={14} /> Импорт…</span>
              </button>
              {dataMsg && <span style={{ fontSize: "var(--fs-2xs)", color: dataError ? "var(--danger, #c0392b)" : COLORS.muted }}>{dataMsg}</span>}
            </div>
          </section>
          </>)}
        </div>
      </div>

      {/* Модальная карточка шаблона задачи — как окно «Новая задача»:
          название, время (системные часы), приоритет, длительность, уведомление.
          Клик по подложке закрывает ТОЛЬКО модалку (stopPropagation), а не
          всю панель настроек — иначе всплытие до внешнего settings-overlay
          закрывало бы всё окно. */}
      {patternModal && (
        <div
          className="settings-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setPatternModal(null);
          }}
          style={{ zIndex: 300 }}
        >
          <div
            className="settings-window"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, maxHeight: "88vh", overflowY: "auto" }}
          >
            <div className="settings-header">
              <h2 className="settings-title">
                <Icon name="gear" size={18} /> {patternModal.id ? "Шаблон задачи" : "Новый шаблон"}
              </h2>
              <button className="icon-btn" onClick={() => setPatternModal(null)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="settings-body">
              <input
                type="text"
                value={patternModal.title}
                onChange={(e) => patchPatternModal({ title: e.target.value })}
                placeholder="Название задачи"
                className="set-name"
                autoFocus
              />
              <div className="set-row" style={{ flexWrap: "wrap", margin: "var(--sp-3) 0" }}>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", minWidth: 64 }}>Время</span>
                <TimePicker
                  value={patternModal.timeMinutes}
                  onChange={(m) => patchPatternModal({ timeMinutes: m })}
                  durationMinutes={patternModal.durationMinutes}
                  onChangeDuration={(m) => patchPatternModal({ durationMinutes: m })}
                  large
                />
              </div>
              <div className="set-row" style={{ flexWrap: "wrap", margin: "var(--sp-3) 0" }}>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", minWidth: 64 }}>Приоритет</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
                  {PATTERN_PRIO.map((p) => (
                    <button
                      key={p.v}
                      type="button"
                      onClick={() => patchPatternModal({ difficulty: p.v })}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "var(--sp-2)",
                        fontSize: "var(--fs-2xs)", padding: "4px 8px", cursor: "pointer",
                        borderRadius: "var(--radius-md)",
                        border: `1px solid ${patternModal.difficulty === p.v ? "var(--accent, #4a90d9)" : "var(--border-color)"}`,
                        background: "transparent", color: "var(--text-primary)",
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color || "var(--text-muted)", display: "inline-block" }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row" style={{ flexWrap: "wrap", margin: "var(--sp-3) 0" }}>
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)", minWidth: 64 }}>Уведомить</span>
                <select
                  value={patternModal.notifyMinutes == null ? -1 : patternModal.notifyMinutes}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    patchPatternModal({ notifyMinutes: v < 0 ? null : v });
                  }}
                  className="set-name"
                  style={{ background: "var(--bg-tertiary)" }}
                >
                  {PATTERN_NOTIFY.map((o) => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                {patternModal.id && (
                  <button
                    className="preset-btn danger"
                    onClick={() => removePatternDraft(patternModal)}
                    title="Удалить шаблон"
                  >
                    <Icon name="close" size={14} /> Удалить
                  </button>
                )}
                <button
                  className="preset-btn"
                  onClick={() => savePatternDraft(patternModal)}
                  style={{ flex: 1, background: "var(--accent, #4a90d9)", color: "#fff", border: "none" }}
                  title="Сохранить шаблон"
                >
                  Сохранить
                </button>
                <button
                  className="preset-btn"
                  onClick={() => setPatternModal(null)}
                  title="Отмена"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
