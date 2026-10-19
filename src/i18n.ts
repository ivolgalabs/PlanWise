/**
 * PlanWise i18n — 9 языков (тот же набор, что в Convertia / ComiFlow / TensorMedia):
 * ru, en, es, de, fr, pt, zh, ja, ko.
 *
 * Паритет ключей обеспечивает компилятор: все языковые блоки аннотированы
 * `Dict = typeof ru`, поэтому пропущенный или лишний ключ — ошибка tsc.
 * В ru-блок строки — исходные тексты приложения (дословно).
 *
 * Подстановки — `{name}`; см. t()/interpolate ниже.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

export type Lang = "ru" | "en" | "es" | "de" | "fr" | "pt" | "zh" | "ja" | "ko";

export const LANGS: { code: Lang; name: string }[] = [
  { code: "ru", name: "Русский" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "pt", name: "Português" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
];

const STORAGE_KEY = "planwise_lang";

/** Сохранённый язык → язык системы → английский (международный фолбэк). */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch {
    /* localStorage недоступен — фолбэк ниже */
  }
  const code = (navigator.language || "en").split("-")[0] as Lang;
  return LANGS.some((l) => l.code === code) ? code : "en";
}

/** Дублирует язык в Rust: тексты нативных уведомлений строятся там
 *  (src-tauri/src/app_lang.rs, команда set_app_lang). В браузерной сборке
 *  Tauri-хоста нет — вызов обязан молча ничего не делать. */
function syncLangToRust(lang: Lang): void {
  try {
    void invoke("set_app_lang", { lang }).catch(() => {
      /* нет Tauri-хоста (браузерный dev) */
    });
  } catch {
    /* нет Tauri-хоста (браузерный dev) */
  }
}

export function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  } catch {
    /* ignore */
  }
  syncLangToRust(lang);
}

const ru = {
  // ── Общее ────────────────────────────────────────────────────────────
  "common.delete": "Удалить",
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.add": "Добавить",
  "common.retry": "Повторить",
  "common.untitled": "Без названия",
  "common.unnamed": "без названия",
  "common.noTitle": "(без названия)",
  "common.noCategory": "Без категории",
  "common.expand": "Развернуть",
  "common.collapse": "Свернуть",
  "common.archive": "Архив",
  "common.today": "Сегодня",
  "common.all": "Все",
  "common.doneFilter": "Выполн.",
  "common.someday": "Позже",
  "common.remove": "Убрать",
  "common.import": "Импорт",

  // ── Язык / язык интерфейса ───────────────────────────────────────────
  "lang.language": "Язык",
  "lang.hint": "Применяется сразу ко всему интерфейсу",

  // ── Общие подписи виджетов (тема, время, диалоги) ────────────────────
  "common.close": "Закрыть",
  "common.done": "Готово",
  "common.ok": "ОК",
  "theme.light": "Светлая",
  "theme.dark": "Тёмная",
  "theme.system": "Системная",
  "time.ownTime": "Своё время",
  "time.leaveEarly": "Выехать заранее",
  "time.duration": "Длительность",
  "time.changeTime": "Изменить время",
  "time.hoursMax": "Часы (до {n})",
  "time.minutes": "Минуты",
  "time.applyValue": "Применить значение",
  "time.pickSystem": "Выбрать время системными часами",

  // ── Единицы измерения ────────────────────────────────────────────────
  "unit.min": "мин",
  "unit.hour": "ч",
  "unit.minutesN": "{n} мин",
  "unit.hoursN": "{n} ч",
  "unit.hoursMinN": "{n} ч {m} мин",
  "unit.daysN": "за {n} дн",
  "unit.daysHoursN": "за {n} дн {m} ч",
  "unit.mb": "{n} МБ",
  "unit.kb": "{n} КБ",
  "unit.b": "{n} Б",
  "unit.noDuration": "без длительности",

  // ── Даты (date.ts) ───────────────────────────────────────────────────
  "date.overdue": "просрочено · {date}",
  "date.withinWeek": "в течение недели",
  "date.withinMonth": "в течение месяца",
  "date.until": "до {date}",
  "date.eve": " (накануне)",
  "date.departure": "выезд в {time}",
  "date.plusDays": " (+{n} дн.)",

  // ── App ──────────────────────────────────────────────────────────────
  "app.loadError":
    "Не удалось загрузить задачи. Проверьте доступ к данным приложения.",
  "app.hide": "Скрыть",
  "app.loading": "Загрузка…",
  "app.resizeHandle": "Тяните, чтобы изменить ширину",
  "app.fatalTitle": "Что-то пошло не так",
  "app.reload": "Перезагрузить",

  // ── Ошибки (тосты, сообщения форм) ───────────────────────────────────
  "err.saveTask": "Не удалось сохранить задачу: {error}",
  "err.createTask": "Не удалось создать задачу: {error}",
  "err.saveTaskShort": "Не удалось сохранить задачу",
  "err.duplicateTask": "Не удалось продублировать задачу",
  "err.saveTaskCheck":
    "Не удалось сохранить задачу — проверьте данные приложения",
  "err.promoteSubtask": "Не удалось создать задачу из подзадачи: {error}",
  "err.addSubtask": "Не удалось добавить подзадачу: {error}",
  "err.toggleSubtask": "Не удалось отметить подзадачу: {error}",
  "err.renameSubtask": "Не удалось переименовать подзадачу: {error}",
  "err.loadSubtasks": "Не удалось загрузить подзадачи",
  "err.attachFile": "Не удалось прикрепить «{name}»",
  "err.readFile": "Не удалось прочитать файл",
  "err.encodeFile": "Не удалось закодировать файл",
  "err.syncRead":
    "Не удалось прочитать файл синхронизации — проверьте папку в настройках",
  "err.appOnly": "Доступно в приложении",
  "err.taskNotFound": "Задача не найдена",
  "err.localDataCorrupt":
    "Локальные данные повреждены — сохранена копия, изменения начнутся заново",

  // ── Категории по умолчанию (браузерный фоллбек) ──────────────────────
  "cat.work": "Работа",
  "cat.personal": "Личное",
  "cat.sport": "Спорт",

  // ── Виды ─────────────────────────────────────────────────────────────
  "view.day": "День",
  "view.week": "Неделя",
  "view.month": "Месяц",

  // ── Верхняя панель ───────────────────────────────────────────────────
  "topBar.prev": "Назад",
  "topBar.next": "Вперёд",
  "topBar.pickDate": "Выбрать дату",
  "topBar.gridTitle": "Сетка (горизонтально)",
  "topBar.listTitle": "Список (вертикально)",
  "topBar.gridAria": "Показать неделю сеткой",
  "topBar.listAria": "Показать неделю списком",
  "topBar.gridLabel": "сеткой",
  "topBar.listLabel": "списком",
  "topBar.closeSearch": "Закрыть поиск",
  "topBar.search": "Поиск задач",
  "topBar.date": "Дата",
  "topBar.settings": "Настройки",

  // ── Мини-календарь ───────────────────────────────────────────────────
  "calendar.prevMonth": "Предыдущий месяц",
  "calendar.nextMonth": "Следующий месяц",
  "calendar.goToday": "Перейти к сегодняшнему дню",

  // ── Карточка задачи (строка) ─────────────────────────────────────────
  "task.low": "низкий",
  "task.medium": "средний",
  "task.high": "высокий",
  "task.priority": "Приоритет: {label}",
  "task.timeConflict": "Время пересекается с другой задачей",
  "task.configureTime": "Нажмите, чтобы настроить время",
  "task.noTime": "Без привязки ко времени",
  "task.withinDayShort": "в теч. дня",
  "task.withinDay": "в течение дня",
  "task.dueSoft": "Мягкий срок задачи «Позже»",
  "task.dragHint": "Зажмите и тяните на другой день",
  "task.markDone": "Отметить выполненной",
  "task.markUndone": "Отметить невыполненной",
  "close.button": "Закрыть день",
  "close.empty": "Всё разобрано — открытых задач нет",
  "close.tomorrow": "Завтра",
  "close.someday": "Позже",
  "close.drop": "Отпустить",
  "close.stuck": "Уже 3 переноса: отпусти, раздели или назначь дату вручную",
  "close.note": "Заметка дня (по желанию)",
  "close.usual": "обычно закрываешь {n} в день",
  "task.edit": "Редактировать задачу (время, категория, заметка…)",
  "task.note": "Заметка",
  "task.empty": "(пустая задача)",
  "task.configure":
    "Настроить задачу: время, приоритет, длительность, категория",
  "task.template": "+ Шаблон",
  "task.archiveCount": "Архив ({n})",
  "task.archiveTitle": "Архив задач",

  // ── Форма задачи (карточка / новая задача) ───────────────────────────
  "form.titlePh": "Название задачи",
  "form.time": "Время",
  "form.priority": "Приоритет",
  "form.due": "Срок",
  "form.noDue": "Без срока",
  "form.repeat": "Повтор",
  "repeat.none": "Не повторять",
  "repeat.daily": "Каждый день",
  "repeat.weekly": "Каждую неделю",
  "repeat.monthly": "Каждый месяц",
  "form.dueDate": "Дата…",
  "form.notify": "Уведомить",
  "form.notifyDefault": "По умолчанию (из настроек)",
  "form.notifyNone": "Не уведомлять",
  "form.allDayHint": "Задача без времени — напомним утром",
  "form.notify5": "За 5 минут",
  "form.notify15": "За 15 минут",
  "form.notify30": "За 30 минут",
  "form.notify60": "За 1 час",
  "form.notify120": "За 2 часа",
  "form.notify180": "За 3 часа",
  "form.notify1440": "За 1 день",
  "form.notifyCustom": "Своё значение…",
  "form.beforeTravel": "До выезда",
  "form.travelNone": "Не напоминать",
  "form.travel5": "За 5 минут до выезда",
  "form.travel15": "За 15 минут до выезда",
  "form.travel30": "За 30 минут до выезда",
  "form.travel60": "За 1 час до выезда",
  "form.color": "Цвет",
  "form.notesPh": "Заметка…",
  "form.files": "Файлы",
  "form.noFilesExisting":
    "Нет файлов. Добавьте документы, фото, аудио — прикрепятся к задаче.",
  "form.noFilesNew":
    "Нет файлов. Добавьте документы, фото, аудио — прикрепятся при сохранении.",
  "form.removeFile": "Удалить файл",
  "form.detachFile": "Убрать файл",
  "form.pickFile": "Выбрать файл (системный диалог)",
  "form.file": "Файл",
  "form.tooBig": "Файл больше 25 МБ — не прикрепится",
  "form.subtasks": "Подзадачи",
  "form.addSubtask": "Добавить подзадачу",
  "form.move": "Перенести",
  "form.moveTitle": "Перенести на другой день",
  "form.duplicate": "Дублировать",
  "form.duplicateTitle":
    "Создать копию с тем же временем (несохранённые правки не копируются)",
  "form.deleteTaskTitle": "Удалить задачу",
  "form.openFile": "Открыть файл",
  "form.confirmDelete": "Удалить задачу «{title}»?",

  // ── Подзадачи (список под задачей) ───────────────────────────────────
  "subtasks.title": "Подзадачи ({done}/{total})",
  "subtasks.addPh": "+ подзадача",
  "subtasks.dragHint": "Перетащите на день (→ задача) или на другую задачу",

  // ── Поиск ────────────────────────────────────────────────────────────
  "search.placeholder": "Поиск задач…",
  "search.period": "Период",
  "search.status": "Статус",
  "search.sort": "Сортировка",
  "search.category": "Категория",
  "search.overdue": "Просроч.",
  "search.days7": "7 дней",
  "search.month": "Месяц",
  "search.custom": "Произвольный…",
  "search.active": "Активные",
  "search.dateAsc": "По дате ↑",
  "search.dateDesc": "По дате ↓",
  "search.alphaAsc": "А-Я",
  "search.alphaDesc": "Я-А",
  "search.from": "с",
  "search.to": "по",
  "search.nothing": "Ничего не найдено.",
  "search.reset": "Сбросить фильтры",
  "search.found": "Найдено задач: {n}",
  "search.jumpToDay": "Перейти к этому дню",
  "search.isToday": " · сегодня",

  // ── Месяц ────────────────────────────────────────────────────────────
  "month.noTasks": "Нет задач на этот день",
  "month.done": "Сделано",
  "month.dropped": "Отпущено",
  "month.stuck": "Застряло",
  "month.toDay": "К дню",
  "month.toWeek": "К неделе",
  "month.deleteSubtask": "Удалить подзадачу",

  // ── День / неделя ────────────────────────────────────────────────────
  "day.tomorrow": "завтра ▶",
  "day.dragToDate": "Перетащите на {date}",
  "day.noTasks": "Нет задач. Напишите ниже, чтобы добавить.",
  "day.addTaskPh": "+ добавить задачу",
  "day.addPh": "+ добавить",
  "weekShift.title": "Перенести на следующую неделю (+7 дней)",
  "weekShift.label": "следующая неделя ▶",

  // ── «Когда-нибудь» ───────────────────────────────────────────────────
  "someday.week": "В течение недели",
  "someday.month": "В течение месяца",
  "someday.addSomeday": "+ позже",
  "someday.empty": "Пусто. Перетащите сюда или напишите ниже.",
  "someday.addAria": "Добавить задачу",

  // ── Архив ────────────────────────────────────────────────────────────
  "archive.collapse": "Свернуть архив",
  "archive.restoreAllTitle": "Вернуть все задачи архива на выбранную дату",
  "archive.restoreAll": "Вернуть все…",
  "archive.restored": "Возвращено задач: {n}",
  "archive.restoredPartial": "Возвращено {n} из {total}",
  "archive.conflicts": " — задачи с пересечением по времени остались в архиве",
  "archive.empty": "Архив пуст.",
  "archive.restoreTitle": "Вернуть на выбранную дату",
  "archive.restore": "Вернуть…",
  "archive.openTitle": "Открыть архив",

  // ── Drag: подзадача → задача ─────────────────────────────────────────
  "drag.promoteTitle": "Сделать задачей?",
  "drag.promoteBody":
    "Подзадача «{title}» станет самостоятельной задачей на {date}.",
  "drag.promoteConfirm": "Сделать задачей",

  // ── Настройки: каркас и вкладки ──────────────────────────────────────
  "settings.title": "Настройки",
  "settings.tabAppearance": "Оформление",
  "settings.tabTasks": "Задачи",
  "settings.tabTime": "Время",
  "settings.tabNotify": "Уведомления",
  "settings.tabInterface": "Интерфейс",
  "settings.tabCategories": "Категории",
  "settings.tabData": "Данные",

  // ── Настройки: оформление ────────────────────────────────────────────
  "settings.uiScale": "Масштаб интерфейса",
  "settings.uiScaleHint": "От 70% до 200% — применяется ко всем элементам",
  "settings.fontScale": "Размер шрифта",
  "settings.fontScaleHint":
    "Меняет только текст, без масштабирования всего интерфейса",
  "settings.appearance": "Оформление",
  "settings.activeTheme": "Активная тема:",
  "settings.light": "Светлая:",
  "settings.dark": "Тёмная:",
  "settings.savedTag": "сохранена",
  "settings.activeTag": "✓ активна",
  "settings.standard": "Стандартные",
  "settings.custom": "Свой выбор",
  "settings.oledDesc": "Чистый чёрный фон для тёмного режима",
  "settings.accentNote":
    "Свой акцент и фон — поверх выбранной темы. Применяется сразу; сохраните в «Мои стили», чтобы не потерять.",
  "settings.accent": "Акцент",
  "settings.shade": "Оттенок",
  "settings.resetAccent": "Сбросить акцент",
  "settings.customAccent": "Свой акцент: {hex}",
  "settings.accentFromTheme": "Акцент — из темы",
  "settings.background": "Фон",
  "settings.bgTheme": "Из темы",
  "settings.bgLight": "Светлый",
  "settings.bgDark": "Тёмный",
  "settings.shades": "Оттенки:",
  "settings.oledNote": "OLED — чистый чёрный, без оттенков.",
  "settings.bgNote": "Выберите оттенок фона.",
  "settings.myStyles": "Мои стили",
  "settings.myStyle": "Мой стиль",
  "settings.notifyTime": "Время:",
  "settings.slotsHint": "Слоты ☀️/🌙 заполняются при «Применить» из библиотеки",
  "settings.slot": "Слот:",
  "settings.slotApplied": "✓ применён",
  "settings.slotSaved": "сохранён",
  "settings.clearSlot": "Очистить слот",
  "settings.libraryHint": "Библиотека — сохранить, применить, скопировать код",
  "settings.noStyles": "Своих стилей пока нет.",
  "settings.apply": "Применить",
  "settings.copyCode": "Скопировать TMT-код",
  "settings.styleName": "Имя стиля",
  "settings.slotLabel": "Слот",
  "settings.auto": "Авто",
  "settings.lightOpt": "☀️ Светлый",
  "settings.darkOpt": "🌙 Тёмный",
  "settings.importCodePh": "TMT-код для импорта",
  "settings.styleN": "Стиль #{n}",
  "settings.styleExists": "Стиль «{name}» уже есть",
  "settings.savedToLight": "Сохранено в слот ☀️",
  "settings.savedToDark": "Сохранено в слот 🌙",
  "settings.styleApplied": "Применён стиль «{name}»",
  "settings.codeCopied": "Код скопирован: {code}",
  "settings.badCode": "Неверный формат кода",
  "settings.importedName": "Импорт {theme}",
  "settings.styleImported": "Стиль импортирован",

  // ── Настройки: неделя и задачи ───────────────────────────────────────
  "settings.week": "Неделя",
  "settings.mondayFirst": "Начинается с понедельника",
  "settings.weekDefault": "Открывать неделю по умолчанию:",
  "settings.asList": "Списком",
  "settings.asGrid": "Сеткой",
  "settings.tasksSection": "Задачи",
  "settings.preventOverlaps": "Запрещать задачи на одно время",
  "settings.preventOverlapsHint":
    "Не даёт поставить задачу на время, занятое другой (можно добавить как подзадачу). Наложения у старых задач подсвечиваются красным.",
  "settings.sortMode": "Сортировка задач в дне/неделе/месяце:",
  "settings.sortTime": "По времени",
  "settings.sortManual": "Вручную",
  "settings.sortPriority": "По приоритету",
  "settings.sortPriorityHint": "«По приоритету» — высокие задачи сначала",
  "settings.taskTemplates": "Шаблоны задач",
  "settings.taskTemplatesHint":
    "Кнопка «+ Шаблон» в дне/неделе создаёт задачу с этими параметрами",
  "settings.editTemplate": "Изменить шаблон",
  "settings.deleteTemplate": "Удалить шаблон",
  "settings.noTemplates": "Шаблонов пока нет — добавьте первый.",
  "settings.remindFor": " · напом. за {n} мин",
  "settings.subtasksCount": " · {n} подзадач",

  // ── Настройки: время ─────────────────────────────────────────────────
  "settings.quickTime": "Быстрое время",
  "settings.quickTimeHint":
    "Кнопки быстрого выбора времени в карточке задачи (свой список)",
  "settings.timeListEmpty": "Список пуст — добавьте свои варианты времени.",
  "settings.ownTime": "Свое время — системные часы",
  "settings.addTime": "Добавить время",

  // ── Настройки: уведомления ───────────────────────────────────────────
  "settings.notifications": "Уведомления",
  "settings.notifyHint": "Приходят, пока приложение работает (в т.ч. в фоне)",
  "settings.dayDigest": "Список задач на день — утром",
  "settings.reminders": "Напоминания перед задачами со временем",
  "settings.hour1": "1 час",
  "settings.hours2": "2 часа",
  "settings.perDay": "за день",
  "settings.removeInterval": "Убрать этот интервал",
  "settings.addInterval": "Добавить этот интервал",
  "settings.enterHm": "введите ч/мин и нажмите «ОК»",
  "settings.noInterval": "не выбран ни один интервал — напоминаний не будет",
  "settings.perTaskHint":
    "Для отдельной задачи можно задать своё напоминание: нажмите на задачу и выберите «Уведомить» (по умолчанию / не уведомлять / за N минут). Подзадачи напоминают вместе со своей задачей.",

  // ── Настройки: интерфейс ─────────────────────────────────────────────
  "settings.interface": "Интерфейс",
  "settings.interfaceHint": "Скрытые элементы можно вернуть здесь же",
  "settings.visDateBtn": "Кнопка даты (заголовок-дата остаётся)",
  "settings.visMiniCal": "Мини-календарь справа",
  "settings.visNavArrows": "Стрелки навигации ‹ ›",
  "settings.visSearch": "Кнопка поиска",
  "settings.visTaskTime": "Время задач",
  "settings.visSubtasks": "Подзадачи",
  "settings.visNotes": "Заметки",
  "settings.visSomeday": "«Позже»",
  "settings.rightPanel": "Панель справа",
  "settings.rightPanelHint": "Расстояние между календарём и «Позже»",
  "settings.resetInterface": "Сбросить настройки интерфейса",
  "settings.interfaceReset": "Настройки интерфейса сброшены к умолчаниям",

  // ── Настройки: категории ─────────────────────────────────────────────
  "settings.categories": "Категории",
  "settings.categoriesHint":
    "Свои названия и цвета для задач; применяются в меню цвета, календаре и поиске",
  "settings.newCategory": "Новая категория",
  "settings.pickColor": "Выбрать цвет",
  "settings.customColor": "Свой цвет (системный пикер)",
  "settings.customColorTitle": "Свой цвет",
  "settings.categoryNamePh": "Название категории",
  "settings.deleteCategory": "Удалить категорию",
  "settings.noCategories": "Категорий пока нет — добавьте первую.",

  // ── Настройки: данные ────────────────────────────────────────────────
  "settings.data": "Данные",
  "settings.dataHint": "Экспорт — полный бэкап; импорт заменяет текущие данные",
  "settings.exportBackup": "Сохранить бэкап в файл",
  "settings.export": "Экспорт…",
  "settings.importLoad": "Загрузить данные из файла",
  "settings.importBtn": "Импорт…",
  "settings.exported": "Экспортировано ✓",
  "settings.exportCancelled": "Экспорт отменён",
  "settings.importCancelled": "Импорт отменён",
  "settings.confirmReplace":
    "Данные будут ЗАМЕНЕНЫ данными из файла. Продолжить?",
  "settings.imported": "Импортировано задач: {n}",
  "settings.folder": "Папка: {path}",
  "settings.pickFolder": "Выбрать папку для бэкапа",
  "settings.folderBtn": "Папка…",
  "settings.saveNow": "Сохранить бэкап сейчас",
  "settings.savingBackup": "Бэкап сохраняется…",
  "settings.noFolder": "папка не выбрана",
  "settings.autoSync": "Автосинхронизация (в заданную папку)",
  "settings.autoSyncHint":
    "При изменении данных бэкап пишется в файл daily-planner-sync.json; раз в минуту приложение проверяет, не появился ли более свежий файл (с другого устройства) — и заменяет данные. На Android доступен только ручной экспорт/импорт.",
  "settings.quitTitle":
    "Закрыть приложение (на macOS продолжает работать в фоне, пока не выйдете здесь)",
  "settings.quitConfirm":
    "Выйти из приложения? Напоминания и дайджест не будут приходить, пока не запустите снова.",
  "settings.quit": "Выйти из приложения…",
  "settings.templateTitle": "Шаблон задачи",
  "settings.newTemplate": "Новый шаблон",
};

/** Форма словаря: ru — источник, остальные языки обязаны совпасть по ключам. */
export type Dict = typeof ru;
export type TKey = keyof Dict;
export type TVars = Record<string, string | number>;
export type TFunc = (key: TKey, vars?: TVars) => string;

const en: Dict = {
  "common.delete": "Delete",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.add": "Add",
  "common.retry": "Retry",
  "common.untitled": "Untitled",
  "common.unnamed": "untitled",
  "common.noTitle": "(untitled)",
  "common.noCategory": "No category",
  "common.expand": "Expand",
  "common.collapse": "Collapse",
  "common.archive": "Archive",
  "common.today": "Today",
  "common.all": "All",
  "common.doneFilter": "Done",
  "common.someday": "Later",
  "common.remove": "Remove",
  "common.import": "Import",

  "lang.language": "Language",
  "lang.hint": "Applies to the whole interface immediately",

  "common.close": "Close",
  "common.done": "Done",
  "common.ok": "OK",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "time.ownTime": "Custom time",
  "time.leaveEarly": "Leave early",
  "time.duration": "Duration",
  "time.changeTime": "Change time",
  "time.hoursMax": "Hours (up to {n})",
  "time.minutes": "Minutes",
  "time.applyValue": "Apply the value",
  "time.pickSystem": "Pick the time with the system clock",

  "unit.min": "min",
  "unit.hour": "h",
  "unit.minutesN": "{n} min",
  "unit.hoursN": "{n} h",
  "unit.hoursMinN": "{n} h {m} min",
  "unit.daysN": "in {n} d",
  "unit.daysHoursN": "in {n} d {m} h",
  "unit.mb": "{n} MB",
  "unit.kb": "{n} KB",
  "unit.b": "{n} B",
  "unit.noDuration": "no duration",

  "date.overdue": "overdue · {date}",
  "date.withinWeek": "within a week",
  "date.withinMonth": "within a month",
  "date.until": "until {date}",
  "date.eve": " (the day before)",
  "date.departure": "leave at {time}",
  "date.plusDays": " (+{n} d)",

  "app.loadError": "Failed to load tasks. Check access to the app data.",
  "app.hide": "Hide",
  "app.loading": "Loading…",
  "app.resizeHandle": "Drag to resize",
  "app.fatalTitle": "Something went wrong",
  "app.reload": "Reload",

  "err.saveTask": "Failed to save the task: {error}",
  "err.createTask": "Failed to create the task: {error}",
  "err.saveTaskShort": "Failed to save the task",
  "err.duplicateTask": "Failed to duplicate the task",
  "err.saveTaskCheck": "Failed to save the task — check the app data",
  "err.promoteSubtask": "Failed to create a task from the subtask: {error}",
  "err.addSubtask": "Failed to add the subtask: {error}",
  "err.toggleSubtask": "Failed to update the subtask: {error}",
  "err.renameSubtask": "Failed to rename the subtask: {error}",
  "err.loadSubtasks": "Failed to load subtasks",
  "err.attachFile": "Failed to attach “{name}”",
  "err.readFile": "Failed to read the file",
  "err.encodeFile": "Failed to encode the file",
  "err.syncRead": "Failed to read the sync file — check the folder in settings",
  "err.appOnly": "Available in the app only",
  "err.taskNotFound": "Task not found",
  "err.localDataCorrupt":
    "Local data is corrupted — a copy was saved, changes will start over",

  "cat.work": "Work",
  "cat.personal": "Personal",
  "cat.sport": "Sport",

  "view.day": "Day",
  "view.week": "Week",
  "view.month": "Month",

  "topBar.prev": "Back",
  "topBar.next": "Forward",
  "topBar.pickDate": "Pick a date",
  "topBar.gridTitle": "Grid (horizontal)",
  "topBar.listTitle": "List (vertical)",
  "topBar.gridAria": "Show week as a grid",
  "topBar.listAria": "Show week as a list",
  "topBar.gridLabel": "grid",
  "topBar.listLabel": "list",
  "topBar.closeSearch": "Close search",
  "topBar.search": "Search tasks",
  "topBar.date": "Date",
  "topBar.settings": "Settings",

  "calendar.prevMonth": "Previous month",
  "calendar.nextMonth": "Next month",
  "calendar.goToday": "Go to today",

  "task.low": "low",
  "task.medium": "medium",
  "task.high": "high",
  "task.priority": "Priority: {label}",
  "task.timeConflict": "Time overlaps another task",
  "task.configureTime": "Click to set the time",
  "task.noTime": "No time set",
  "task.withinDayShort": "all day",
  "task.withinDay": "all day",
  "task.dueSoft": "Soft deadline of a “Later” task",
  "task.dragHint": "Hold and drag to another day",
  "task.markDone": "Mark as done",
  "task.markUndone": "Mark as not done",
  "close.button": "Close the day",
  "close.empty": "Nothing left open",
  "close.tomorrow": "Tomorrow",
  "close.someday": "Later",
  "close.drop": "Let go",
  "close.stuck": "Postponed 3 times: let it go, split it, or pick a date yourself",
  "close.note": "Day note (optional)",
  "close.usual": "you usually close {n} a day",
  "task.edit": "Edit task (time, category, note…)",
  "task.note": "Note",
  "task.empty": "(empty task)",
  "task.configure": "Configure task: time, priority, duration, category",
  "task.template": "+ Template",
  "task.archiveCount": "Archive ({n})",
  "task.archiveTitle": "Task archive",

  "form.titlePh": "Task title",
  "form.time": "Time",
  "form.priority": "Priority",
  "form.due": "Deadline",
  "form.noDue": "No deadline",
  "form.repeat": "Repeat",
  "repeat.none": "No repeat",
  "repeat.daily": "Every day",
  "repeat.weekly": "Every week",
  "repeat.monthly": "Every month",
  "form.dueDate": "Date…",
  "form.notify": "Notify",
  "form.notifyDefault": "Default (from settings)",
  "form.notifyNone": "Do not notify",
  "form.allDayHint": "Task without a time — we'll remind you in the morning",
  "form.notify5": "5 minutes before",
  "form.notify15": "15 minutes before",
  "form.notify30": "30 minutes before",
  "form.notify60": "1 hour before",
  "form.notify120": "2 hours before",
  "form.notify180": "3 hours before",
  "form.notify1440": "1 day before",
  "form.notifyCustom": "Custom value…",
  "form.beforeTravel": "Before leaving",
  "form.travelNone": "Do not remind",
  "form.travel5": "5 minutes before leaving",
  "form.travel15": "15 minutes before leaving",
  "form.travel30": "30 minutes before leaving",
  "form.travel60": "1 hour before leaving",
  "form.color": "Color",
  "form.notesPh": "Note…",
  "form.files": "Files",
  "form.noFilesExisting":
    "No files. Add documents, photos or audio — they will be attached to the task.",
  "form.noFilesNew":
    "No files. Add documents, photos or audio — they will be attached on save.",
  "form.removeFile": "Delete file",
  "form.detachFile": "Remove file",
  "form.pickFile": "Choose a file (system dialog)",
  "form.file": "File",
  "form.tooBig": "File is larger than 25 MB — it will not be attached",
  "form.subtasks": "Subtasks",
  "form.addSubtask": "Add subtask",
  "form.move": "Move",
  "form.moveTitle": "Move to another day",
  "form.duplicate": "Duplicate",
  "form.duplicateTitle":
    "Create a copy with the same time (unsaved edits are not copied)",
  "form.deleteTaskTitle": "Delete task",
  "form.openFile": "Open file",
  "form.confirmDelete": "Delete task “{title}”?",

  "subtasks.title": "Subtasks ({done}/{total})",
  "subtasks.addPh": "+ subtask",
  "subtasks.dragHint": "Drag to a day (→ task) or to another task",

  "search.placeholder": "Search tasks…",
  "search.period": "Period",
  "search.status": "Status",
  "search.sort": "Sort",
  "search.category": "Category",
  "search.overdue": "Overdue",
  "search.days7": "7 days",
  "search.month": "Month",
  "search.custom": "Custom…",
  "search.active": "Active",
  "search.dateAsc": "By date ↑",
  "search.dateDesc": "By date ↓",
  "search.alphaAsc": "A-Z",
  "search.alphaDesc": "Z-A",
  "search.from": "from",
  "search.to": "to",
  "search.nothing": "Nothing found.",
  "search.reset": "Reset filters",
  "search.found": "Tasks found: {n}",
  "search.jumpToDay": "Go to this day",
  "search.isToday": " · today",

  "month.noTasks": "No tasks for this day",
  "month.done": "Done",
  "month.dropped": "Let go",
  "month.stuck": "Stuck",
  "month.toDay": "To day",
  "month.toWeek": "To week",
  "month.deleteSubtask": "Delete subtask",

  "day.tomorrow": "tomorrow ▶",
  "day.dragToDate": "Drag to {date}",
  "day.noTasks": "No tasks. Type below to add one.",
  "day.addTaskPh": "+ add task",
  "day.addPh": "+ add",
  "weekShift.title": "Move to next week (+7 days)",
  "weekShift.label": "next week ▶",

  "someday.week": "Within a week",
  "someday.month": "Within a month",
  "someday.addSomeday": "+ later",
  "someday.empty": "Empty. Drag here or type below.",
  "someday.addAria": "Add task",

  "archive.collapse": "Collapse archive",
  "archive.restoreAllTitle": "Restore all archived tasks to the selected date",
  "archive.restoreAll": "Restore all…",
  "archive.restored": "Tasks restored: {n}",
  "archive.restoredPartial": "Restored {n} of {total}",
  "archive.conflicts": " — tasks with overlapping time stayed in the archive",
  "archive.empty": "The archive is empty.",
  "archive.restoreTitle": "Restore to the selected date",
  "archive.restore": "Restore…",
  "archive.openTitle": "Open archive",

  "drag.promoteTitle": "Make it a task?",
  "drag.promoteBody":
    "Subtask “{title}” will become a standalone task on {date}.",
  "drag.promoteConfirm": "Make it a task",

  "settings.title": "Settings",
  "settings.tabAppearance": "Appearance",
  "settings.tabTasks": "Tasks",
  "settings.tabTime": "Time",
  "settings.tabNotify": "Notifications",
  "settings.tabInterface": "Interface",
  "settings.tabCategories": "Categories",
  "settings.tabData": "Data",

  "settings.uiScale": "Interface scale",
  "settings.uiScaleHint": "From 70% to 200% — applies to all elements",
  "settings.fontScale": "Font size",
  "settings.fontScaleHint":
    "Changes text only, without scaling the whole interface",
  "settings.appearance": "Appearance",
  "settings.activeTheme": "Active theme:",
  "settings.light": "Light:",
  "settings.dark": "Dark:",
  "settings.savedTag": "saved",
  "settings.activeTag": "✓ active",
  "settings.standard": "Standard",
  "settings.custom": "Custom",
  "settings.oledDesc": "Pure black background for dark mode",
  "settings.accentNote":
    "Custom accent and background on top of the selected theme. Applied immediately; save it to “My styles” so you don't lose it.",
  "settings.accent": "Accent",
  "settings.shade": "Hue",
  "settings.resetAccent": "Reset accent",
  "settings.customAccent": "Custom accent: {hex}",
  "settings.accentFromTheme": "Accent from theme",
  "settings.background": "Background",
  "settings.bgTheme": "From theme",
  "settings.bgLight": "Light",
  "settings.bgDark": "Dark",
  "settings.shades": "Shades:",
  "settings.oledNote": "OLED — pure black, no shades.",
  "settings.bgNote": "Pick a background shade.",
  "settings.myStyles": "My styles",
  "settings.myStyle": "My style",
  "settings.notifyTime": "Time:",
  "settings.slotsHint":
    "The ☀️/🌙 slots are filled by “Apply” from the library",
  "settings.slot": "Slot:",
  "settings.slotApplied": "✓ applied",
  "settings.slotSaved": "saved",
  "settings.clearSlot": "Clear slot",
  "settings.libraryHint": "Library — save, apply, copy the code",
  "settings.noStyles": "No custom styles yet.",
  "settings.apply": "Apply",
  "settings.copyCode": "Copy TMT code",
  "settings.styleName": "Style name",
  "settings.slotLabel": "Slot",
  "settings.auto": "Auto",
  "settings.lightOpt": "☀️ Light",
  "settings.darkOpt": "🌙 Dark",
  "settings.importCodePh": "TMT code to import",
  "settings.styleN": "Style #{n}",
  "settings.styleExists": "Style “{name}” already exists",
  "settings.savedToLight": "Saved to the ☀️ slot",
  "settings.savedToDark": "Saved to the 🌙 slot",
  "settings.styleApplied": "Style “{name}” applied",
  "settings.codeCopied": "Code copied: {code}",
  "settings.badCode": "Invalid code format",
  "settings.importedName": "Import {theme}",
  "settings.styleImported": "Style imported",

  "settings.week": "Week",
  "settings.mondayFirst": "Starts on Monday",
  "settings.weekDefault": "Open the week by default as:",
  "settings.asList": "List",
  "settings.asGrid": "Grid",
  "settings.tasksSection": "Tasks",
  "settings.preventOverlaps": "Forbid tasks at the same time",
  "settings.preventOverlapsHint":
    "Prevents scheduling a task at a time taken by another one (you can add it as a subtask). Overlaps of older tasks are highlighted in red.",
  "settings.sortMode": "Task sorting in day/week/month:",
  "settings.sortTime": "By time",
  "settings.sortManual": "Manual",
  "settings.sortPriority": "By priority",
  "settings.sortPriorityHint": "“By priority” — high-priority tasks first",
  "settings.taskTemplates": "Task templates",
  "settings.taskTemplatesHint":
    "The “+ Template” button in day/week creates a task with these settings",
  "settings.editTemplate": "Edit template",
  "settings.deleteTemplate": "Delete template",
  "settings.noTemplates": "No templates yet — add the first one.",
  "settings.remindFor": " · remind {n} min before",
  "settings.subtasksCount": " · {n} subtasks",

  "settings.quickTime": "Quick time",
  "settings.quickTimeHint":
    "Quick time buttons in the task card (your own list)",
  "settings.timeListEmpty": "The list is empty — add your own time options.",
  "settings.ownTime": "Custom time — system clock",
  "settings.addTime": "Add time",

  "settings.notifications": "Notifications",
  "settings.notifyHint":
    "Delivered while the app is running (including in the background)",
  "settings.dayDigest": "Task list for the day — in the morning",
  "settings.reminders": "Reminders before timed tasks",
  "settings.hour1": "1 hour",
  "settings.hours2": "2 hours",
  "settings.perDay": "a day before",
  "settings.removeInterval": "Remove this interval",
  "settings.addInterval": "Add this interval",
  "settings.enterHm": "enter h/min and press “OK”",
  "settings.noInterval": "no interval selected — there will be no reminders",
  "settings.perTaskHint":
    "For a single task you can set its own reminder: tap the task and choose “Notify” (default / do not notify / N minutes before). Subtasks remind together with their task.",

  "settings.interface": "Interface",
  "settings.interfaceHint": "Hidden elements can be brought back here",
  "settings.visDateBtn": "Date button (the date title stays)",
  "settings.visMiniCal": "Mini calendar on the right",
  "settings.visNavArrows": "Navigation arrows ‹ ›",
  "settings.visSearch": "Search button",
  "settings.visTaskTime": "Task time",
  "settings.visSubtasks": "Subtasks",
  "settings.visNotes": "Notes",
  "settings.visSomeday": "“Later”",
  "settings.rightPanel": "Right panel",
  "settings.rightPanelHint": "Distance between the calendar and “Later”",
  "settings.resetInterface": "Reset interface settings",
  "settings.interfaceReset": "Interface settings reset to defaults",

  "settings.categories": "Categories",
  "settings.categoriesHint":
    "Your own names and colors for tasks; used in the color menu, calendar and search",
  "settings.newCategory": "New category",
  "settings.pickColor": "Pick a color",
  "settings.customColor": "Custom color (system picker)",
  "settings.customColorTitle": "Custom color",
  "settings.categoryNamePh": "Category name",
  "settings.deleteCategory": "Delete category",
  "settings.noCategories": "No categories yet — add the first one.",

  "settings.data": "Data",
  "settings.dataHint":
    "Export is a full backup; import replaces the current data",
  "settings.exportBackup": "Save a backup to a file",
  "settings.export": "Export…",
  "settings.importLoad": "Load data from a file",
  "settings.importBtn": "Import…",
  "settings.exported": "Exported ✓",
  "settings.exportCancelled": "Export cancelled",
  "settings.importCancelled": "Import cancelled",
  "settings.confirmReplace":
    "The data will be REPLACED with the data from the file. Continue?",
  "settings.imported": "Tasks imported: {n}",
  "settings.folder": "Folder: {path}",
  "settings.pickFolder": "Choose a folder for the backup",
  "settings.folderBtn": "Folder…",
  "settings.saveNow": "Save the backup now",
  "settings.savingBackup": "Saving the backup…",
  "settings.noFolder": "no folder selected",
  "settings.autoSync": "Auto-sync (to a chosen folder)",
  "settings.autoSyncHint":
    "On every data change a backup is written to daily-planner-sync.json; once a minute the app checks whether a newer file appeared (from another device) and replaces the data. On Android only manual export/import is available.",
  "settings.quitTitle":
    "Close the app (on macOS it keeps running in the background until you quit here)",
  "settings.quitConfirm":
    "Quit the app? Reminders and the digest will not arrive until you start it again.",
  "settings.quit": "Quit the app…",
  "settings.templateTitle": "Task template",
  "settings.newTemplate": "New template",
};

// ru (источник типа) и en (фолбэк) — в основном чанке; остальные языки
// грузятся отдельными чанками по требованию (loadLang).
const DICT: Partial<Record<Lang, Dict>> & { ru: Dict; en: Dict } = { ru, en };

const LOADERS: Record<
  Exclude<Lang, "ru" | "en">,
  () => Promise<{ default: Dict }>
> = {
  es: () => import("./locales/es"),
  de: () => import("./locales/de"),
  fr: () => import("./locales/fr"),
  pt: () => import("./locales/pt"),
  zh: () => import("./locales/zh"),
  ja: () => import("./locales/ja"),
  ko: () => import("./locales/ko"),
};

/** Догрузить словарь языка; при ошибке t() остаётся на фолбэке en. */
export async function loadLang(lang: Lang): Promise<void> {
  if (DICT[lang]) return;
  try {
    DICT[lang] = (await LOADERS[lang as keyof typeof LOADERS]()).default;
  } catch (e) {
    console.error("i18n: failed to load", lang, e);
  }
}

let currentLang: Lang = detectLang();
// Стартовый язык сразу фиксируем в localStorage и на <html lang> — чтобы
// date-locale и системные подписи совпадали с первым же рендером.
storeLang(currentLang);

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

let pendingLang: Lang | null = null;

export function setLang(lang: Lang): void {
  pendingLang = lang;
  if (lang === currentLang) return;
  void loadLang(lang).then(() => {
    // Быстрое переключение подряд: применяем только последний выбор.
    if (pendingLang !== lang) return;
    currentLang = lang;
    storeLang(lang);
    for (const cb of listeners) cb();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Подписка на смену языка (модульный стор) — без контекста. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Подстановка `{name}` в строку; неизвестные токены остаются как есть. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/** Перевод по ключу текущего языка (фолбэк — английский, затем ru, затем ключ). */
export function t(key: TKey, vars?: TVars): string {
  const dict = DICT[currentLang] ?? DICT.en;
  const s = dict[key] ?? DICT.en[key] ?? DICT.ru[key] ?? String(key);
  return interpolate(s, vars);
}

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Провайдер: держит текущий язык и перерисовывает всех потребителей хука. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang]);
  return createElement(I18nContext.Provider, { value }, children);
}

/** Хук компонента: { lang, setLang, t }. Вне провайдера (тесты, порталы до
 *  маунта) работает через модульный фолбэк — с той же подпиской на язык. */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  const lang = useLang();
  const fallback = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang]);
  return ctx ?? fallback;
}
