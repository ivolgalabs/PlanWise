package com.zkproject.dailyplanner

import android.content.Context
import android.content.res.Resources
import android.database.sqlite.SQLiteDatabase
import android.util.TypedValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Данные виджетов: чтение/запись files/widget.json (пишет Rust-команда
 * write_widget_data), генерация из SQLite (для быстрого добавления задачи
 * без запуска приложения), отметка «выполнено» тапом по строке и палитра
 * Universal UI.
 *
 * Формат widget.json — общий с Rust и macOS-виджетами:
 *   {"date": N, "dark": bool,
 *    "tasks": [{id, title, timeMinutes, isDone}],   // сегодня (≤8)
 *    "week":  [{date, tasks: [...]}],               // 7 дней (≤4/день)
 *    "someday": [...],                               // без даты (≤8)
 *    "dayWindow": [{date, tasks: [...]}]}            // вчера..+5 (≤8/день)
 * id нужен виджету, чтобы отмечать задачу выполненной (UPDATE по id).
 */
object WidgetData {

  data class WTask(val id: String, val title: String, val timeMinutes: Int?, val isDone: Boolean)
  data class WDay(val date: Long, val tasks: List<WTask>)
  data class Payload(
    val date: Long,
    val dark: Boolean,
    val tasks: List<WTask>,
    val week: List<WDay>,
    val someday: List<WTask>,
    val dayWindow: List<WDay>,
  )

  /** Путь к БД приложения: <data>/daily_planner.sqlite (см. db.rs в Rust). */
  fun dbFile(context: Context): File = File(context.filesDir.parentFile, "daily_planner.sqlite")

  /** epoch-day «сегодня» по локальной дате — как toEpochDay на фронте и
   *  today_epoch_day в Rust. minSdk 24 — без java.time, считаем через UTC. */
  fun todayEpochDay(): Long {
    val now = Calendar.getInstance()
    val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    utc.clear()
    utc.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH))
    return utc.timeInMillis / 86_400_000L
  }

  /** Читает и разбирает files/widget.json; null — файла нет или битый. */
  fun readFile(context: Context): Payload? {
    return try {
      val f = File(context.filesDir, "widget.json")
      if (!f.exists()) null else parse(JSONObject(f.readText()))
    } catch (e: Exception) {
      null
    }
  }

  /** Разбор JSON-объекта widget.json в Payload. */
  fun parse(o: JSONObject): Payload {
    fun tasks(a: JSONArray?): List<WTask> {
      if (a == null) return emptyList()
      val out = mutableListOf<WTask>()
      for (i in 0 until a.length()) {
        val t = a.getJSONObject(i)
        val tm = t.opt("timeMinutes")
        out.add(
          WTask(
            t.optString("id"),
            t.optString("title"),
            if (tm == null || JSONObject.NULL == tm) null else (tm as Number).toInt(),
            t.optBoolean("isDone"),
          )
        )
      }
      return out
    }
    fun days(a: JSONArray?): List<WDay> {
      if (a == null) return emptyList()
      val out = mutableListOf<WDay>()
      for (i in 0 until a.length()) {
        val d = a.getJSONObject(i)
        out.add(WDay(d.optLong("date"), tasks(d.optJSONArray("tasks"))))
      }
      return out
    }
    return Payload(
      o.optLong("date"),
      o.optBoolean("dark"),
      tasks(o.optJSONArray("tasks")),
      days(o.optJSONArray("week")),
      tasks(o.optJSONArray("someday")),
      days(o.optJSONArray("dayWindow")),
    )
  }

  /** Атомарная запись: tmp + rename (виджет не прочитает обрезанный JSON). */
  fun writeFile(context: Context, p: Payload) {
    val f = File(context.filesDir, "widget.json")
    val tmp = File(context.filesDir, "widget.json.tmp")
    tmp.writeText(toJson(p).toString())
    if (f.exists()) f.delete()
    tmp.renameTo(f)
  }

  fun toJson(p: Payload): JSONObject {
    fun tasks(a: List<WTask>): JSONArray {
      val arr = JSONArray()
      for (t in a) {
        val o = JSONObject()
        o.put("id", t.id)
        o.put("title", t.title)
        if (t.timeMinutes != null) o.put("timeMinutes", t.timeMinutes)
        o.put("isDone", t.isDone)
        arr.put(o)
      }
      return arr
    }
    fun days(a: List<WDay>): JSONArray {
      val arr = JSONArray()
      for (d in a) {
        val w = JSONObject()
        w.put("date", d.date)
        w.put("tasks", tasks(d.tasks))
        arr.put(w)
      }
      return arr
    }
    val o = JSONObject()
    o.put("date", p.date)
    o.put("dark", p.dark)
    o.put("tasks", tasks(p.tasks))
    o.put("week", days(p.week))
    o.put("someday", tasks(p.someday))
    o.put("dayWindow", days(p.dayWindow))
    return o
  }

  // ── SQLite (только для быстрого добавления) ────────────────────────────

  /** Есть ли нужные колонки в tasks (миграции накатывает только Rust — если
   *  БД создана не им, прямой записью из виджета испортим данные). */
  private fun schemaReady(db: SQLiteDatabase): Boolean {
    return try {
      val cols = db.rawQuery("PRAGMA table_info(tasks)", null).use { c ->
        val set = HashSet<String>()
        while (c.moveToNext()) set.add(c.getString(1))
        set
      }
      cols.contains("someday") && cols.contains("notify_minutes") && cols.contains("archived")
    } catch (e: Exception) {
      false
    }
  }

  /** Режим даты быстрого добавления (совпадает с чипами в диалоге). */
  enum class QuickMode { TODAY, TOMORROW, SOMEDAY, EXACT }

  /**
   * Добавить задачу напрямую в SQLite (те же defaults, что у Rust-команды
   * upsert_task), перегенерировать widget.json и обновить виджеты.
   * exactDay — epoch-day для режима EXACT (чип «Другая дата»).
   * Возвращает null при успехе или текст ошибки (показываем тостом).
   * Код "DB_MISSING" — БД ещё не создана приложением (миграции накатывает
   * только Rust) — Activity переводит его в понятную подсказку.
   */
  fun addQuickTask(context: Context, title: String, mode: QuickMode, exactDay: Long? = null): String? {
    val dbFile = dbFile(context)
    if (!dbFile.exists()) return DB_MISSING
    return try {
      val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READWRITE)
      try {
        // PRAGMA через execSQL Android запрещает («query or rawQuery only»).
        db.rawQuery("PRAGMA busy_timeout=5000", null).use { }
        if (!schemaReady(db)) return DB_MISSING
        val now = System.currentTimeMillis()
        val today = todayEpochDay()
        val someday = mode == QuickMode.SOMEDAY
        val date = when (mode) {
          QuickMode.TODAY -> today
          QuickMode.TOMORROW -> today + 1
          QuickMode.SOMEDAY -> 0L
          QuickMode.EXACT -> exactDay ?: today
        }
        val cv = android.content.ContentValues().apply {
          put("id", UUID.randomUUID().toString())
          put("title", title)
          put("date", date)
          put("is_done", 0)
          putNull("color_set_id")
          put("sort_order", now.toDouble())
          put("created_at", now)
          put("updated_at", now)
          put("device_id", "")
          putNull("time_minutes")
          put("notes", "")
          put("someday", if (someday) 1 else 0)
          put("archived", 0)
          putNull("travel_time")
          putNull("duration_minutes")
          put("difficulty", 0)
          putNull("notify_minutes")
        }
        if (db.insertWithOnConflict("tasks", null, cv, SQLiteDatabase.CONFLICT_REPLACE) == -1L) {
          return "Не удалось сохранить задачу"
        }
      } finally {
        db.close()
      }
      // Виджет должен показать новую задачу сразу: перегенерируем данные
      // (SQL повторяет refresh_widget из Rust — осознанное дублирование
      // между языками, сведённое к одному месту) и обновляем все виджеты.
      val payload = generateFromDb(context) ?: return DB_MISSING
      writeFile(context, payload)
      WidgetProvider.updateAll(context)
      null
    } catch (e: Exception) {
      e.printStackTrace()
      "Не удалось сохранить задачу"
    }
  }

  /**
   * Отметить задачу выполненной/невыполненной тапом по строке в виджете:
   * UPDATE в SQLite (как upsert_task в Rust), затем перегенерация widget.json
   * и обновление виджетов. Возвращает null при успехе или текст ошибки —
   * вызывается из BroadcastReceiver, ошибку тихо логируем.
   */
  fun toggleTaskDone(context: Context, taskId: String): String? {
    val dbFile = dbFile(context)
    if (!dbFile.exists()) return DB_MISSING
    return try {
      val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READWRITE)
      // Текущее значение нужно, чтобы переключить 1-is_done (UPDATE с
      // выражением через ContentValues не сделать).
      var current = 0
      try {
        db.rawQuery("PRAGMA busy_timeout=5000", null).use { }
        if (!schemaReady(db)) return DB_MISSING
        db.rawQuery("SELECT is_done FROM tasks WHERE id = ?", arrayOf(taskId)).use { c ->
          if (c.moveToFirst()) current = c.getInt(0)
        }
        val cv = android.content.ContentValues().apply {
          put("is_done", if (current == 0) 1 else 0)
          put("updated_at", System.currentTimeMillis())
        }
        db.update("tasks", cv, "id = ?", arrayOf(taskId))
        if (current == 0) spawnNextRepeat(db, taskId)
      } finally {
        db.close()
      }
      if (current == 0) cancelTaskAlarms(context, taskId)
      // Задача могла исчезнуть (удалена в приложении) — всё равно
      // перегенерируем файл, виджет покажет актуальное состояние.
      val payload = generateFromDb(context) ?: return DB_MISSING
      writeFile(context, payload)
      WidgetProvider.updateAll(context)
      null
    } catch (e: Exception) {
      e.printStackTrace()
      "Не удалось обновить задачу"
    }
  }

  private fun utcCal(): Calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"))

  /** Первая дата серии строго после today (ср. next_repeat_date в commands.rs):
   *  месяц считается от исходной даты, 31-е прижимается к концу месяца. */
  internal fun nextRepeatDay(date: Long, repeat: String, today: Long): Long? {
    val base = utcCal().apply { timeInMillis = date * 86_400_000L }
    for (k in 1..1200) {
      val e = when (repeat) {
        "daily" -> date + k
        "weekly" -> date + 7L * k
        "monthly" -> {
          val c = utcCal()
          c.clear()
          c.set(base.get(Calendar.YEAR), base.get(Calendar.MONTH) + k, 1)
          c.set(Calendar.DAY_OF_MONTH, minOf(base.get(Calendar.DAY_OF_MONTH), c.getActualMaximum(Calendar.DAY_OF_MONTH)))
          c.timeInMillis / 86_400_000L
        }
        else -> return null
      }
      if (e > today) return e
    }
    return null
  }

  /**
   * Закрытая с виджета повторяющаяся задача рождает следующее вхождение — как
   * spawn_next_repeat в Rust (копия строки со сдвинутой датой + подзадачи
   * невыполненными; дубль на ту же дату не плодим).
   * shortcut: напоминания копии поставит сверка при запуске приложения.
   */
  private fun spawnNextRepeat(db: SQLiteDatabase, taskId: String) {
    db.rawQuery("SELECT * FROM tasks WHERE id = ?", arrayOf(taskId)).use { c ->
      if (!c.moveToFirst()) return
      val ri = c.getColumnIndex("repeat")
      if (ri < 0 || c.isNull(ri)) return
      val repeat = c.getString(ri)
      if (c.getInt(c.getColumnIndexOrThrow("someday")) != 0 || c.getInt(c.getColumnIndexOrThrow("archived")) != 0) return
      val title = c.getString(c.getColumnIndexOrThrow("title"))
      val next = nextRepeatDay(c.getLong(c.getColumnIndexOrThrow("date")), repeat, todayEpochDay()) ?: return
      val exists = db.rawQuery(
        "SELECT COUNT(*) FROM tasks WHERE title = ? AND repeat = ? AND date = ? AND is_done = 0",
        arrayOf(title, repeat, next.toString()),
      ).use { q -> q.moveToFirst() && q.getInt(0) > 0 }
      if (exists) return
      val now = System.currentTimeMillis()
      val newId = UUID.randomUUID().toString()
      val over = mapOf<String, Any?>(
        "id" to newId, "date" to next, "is_done" to 0, "archived" to 0, "done_at" to null,
        "dropped_at" to null, "postpone_count" to 0, "created_at" to now, "updated_at" to now,
        "sort_order" to now.toDouble(),
      )
      val cv = android.content.ContentValues()
      for (i in 0 until c.columnCount) {
        val name = c.getColumnName(i)
        if (over.containsKey(name)) {
          when (val v = over[name]) {
            null -> cv.putNull(name)
            is Int -> cv.put(name, v)
            is Long -> cv.put(name, v)
            is Double -> cv.put(name, v)
            else -> cv.put(name, v.toString())
          }
          continue
        }
        when (c.getType(i)) {
          android.database.Cursor.FIELD_TYPE_INTEGER -> cv.put(name, c.getLong(i))
          android.database.Cursor.FIELD_TYPE_FLOAT -> cv.put(name, c.getDouble(i))
          android.database.Cursor.FIELD_TYPE_STRING -> cv.put(name, c.getString(i))
          android.database.Cursor.FIELD_TYPE_NULL -> cv.putNull(name)
          else -> {}
        }
      }
      db.beginTransaction()
      try {
        db.insertOrThrow("tasks", null, cv)
        db.rawQuery("SELECT title, sort_order FROM subtasks WHERE task_id = ?", arrayOf(taskId)).use { s ->
          while (s.moveToNext()) {
            db.insertOrThrow("subtasks", null, android.content.ContentValues().apply {
              put("id", UUID.randomUUID().toString())
              put("task_id", newId)
              put("title", s.getString(0))
              put("is_done", 0)
              put("sort_order", s.getDouble(1))
              put("created_at", now)
            })
          }
        }
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
      }
    }
  }

  /**
   * Снять будильники напоминаний задачи, отмеченной выполненной с виджета:
   * при убитом процессе Rust-сверка (sync_scheduled) не запустится, и
   * напоминание пришло бы по уже сделанной задаче. Карту taskId → id пишет
   * Rust (files/notify-tasks.json); снятие повторяет
   * TauriNotificationManager.cancel плагина: PendingIntent публикатора с тем
   * же request code + запись в NOTIFICATION_STORE.
   * shortcut: снятие «выполнено» обратно будильники не возвращает — их
   * поставит следующая сверка при запуске приложения.
   */
  private fun cancelTaskAlarms(context: Context, taskId: String) {
    try {
      val f = File(context.filesDir, "notify-tasks.json")
      if (!f.exists()) return
      val ids = JSONObject(f.readText()).optJSONArray(taskId) ?: return
      val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
      val store = context.getSharedPreferences("NOTIFICATION_STORE", Context.MODE_PRIVATE).edit()
      val flags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
        android.app.PendingIntent.FLAG_MUTABLE
      } else {
        0
      }
      for (i in 0 until ids.length()) {
        val id = ids.getInt(i)
        val intent = android.content.Intent(context, app.tauri.notification.TimedNotificationPublisher::class.java)
        am.cancel(android.app.PendingIntent.getBroadcast(context, id, intent, flags))
        store.remove(id.toString())
      }
      store.apply()
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  /** БД ещё не создана приложением (или схема устарела). */
  const val DB_MISSING = "DB_MISSING"

  /**
   * Генерирует widget.json прямо из SQLite — та же логика, что refresh_widget
   * в Rust (сегодня ≤8, неделя 7×≤4, «Позже» ≤8, окно вчера..+5 ≤8).
   * Тему (dark) берём из текущего файла, чтобы быстрый ввод не переключал
   * виджет на светлую тему.
   */
  fun generateFromDb(context: Context): Payload? {
    val dbFile = dbFile(context)
    if (!dbFile.exists()) return null
    return try {
      val db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)
      try {
        db.rawQuery("PRAGMA busy_timeout=5000", null).use { }
        val dark = readFile(context)?.dark ?: false
        val today = todayEpochDay()
        fun queryTasks(sql: String, arg: Long?): List<WTask> {
          val cur = if (arg != null) db.rawQuery(sql, arrayOf(arg.toString())) else db.rawQuery(sql, null)
          return cur.use { c ->
            val out = mutableListOf<WTask>()
            while (c.moveToNext()) {
              val tm = if (c.isNull(2)) null else c.getInt(2)
              out.add(WTask(c.getString(0), c.getString(1), tm, c.getInt(3) != 0))
            }
            out
          }
        }
        val tasks = queryTasks(
          "SELECT id, title, time_minutes, is_done FROM tasks WHERE date=? AND archived=0 AND someday=0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8",
          today,
        )
        val week = (0 until 7).map { off ->
          WDay(
            today + off,
            queryTasks(
              "SELECT id, title, time_minutes, is_done FROM tasks WHERE date=? AND archived=0 AND someday=0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 4",
              today + off,
            ),
          )
        }
        val someday = queryTasks(
          "SELECT id, title, time_minutes, is_done FROM tasks WHERE someday=1 AND archived=0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8",
          null,
        )
        // Окно дней для интерактивного виджета «День» (стрелки ‹ ›):
        // вчера..+13, до 8 задач на день — как dayWindow в Rust. +13 — чтобы
        // задачи из «Другая дата» были видны в виджете.
        val dayWindow = (0 until 15).map { off ->
          WDay(
            today - 1 + off,
            queryTasks(
              "SELECT id, title, time_minutes, is_done FROM tasks WHERE date=? AND archived=0 AND someday=0 ORDER BY (time_minutes IS NULL) ASC, time_minutes ASC, difficulty DESC, sort_order ASC, created_at ASC LIMIT 8",
              today - 1 + off,
            ),
          )
        }
        Payload(today, dark, tasks, week, someday, dayWindow)
      } finally {
        db.close()
      }
    } catch (e: Exception) {
      e.printStackTrace()
      null
    }
  }

  // ── Палитра Universal UI (light-slate / dark-slate) ────────────────────

  /** Палитра виджета по теме: фон/текст/вторичный/приглушённый/акцент. */
  data class Palette(
    val bgRes: Int, val text: Int, val secondary: Int, val muted: Int, val accent: Int,
  )

  fun palette(dark: Boolean, r: Resources): Palette = if (dark) {
    Palette(
      R.drawable.widget_bg_dark,
      r.getColor(R.color.widget_text_dark, null),
      r.getColor(R.color.widget_secondary_dark, null),
      r.getColor(R.color.widget_muted_dark, null),
      r.getColor(R.color.widget_accent, null),
    )
  } else {
    Palette(
      R.drawable.widget_bg_light,
      r.getColor(R.color.widget_text_light, null),
      r.getColor(R.color.widget_secondary_light, null),
      r.getColor(R.color.widget_muted_light, null),
      r.getColor(R.color.widget_accent, null),
    )
  }

  /** «задача / задачи / задач» — русские правила множественного числа. */
  fun pluralShort(n: Int): String = when {
    n % 10 == 1 && n % 100 != 11 -> "задача"
    n % 10 in 2..4 && n % 100 !in 12..14 -> "задачи"
    else -> "задач"
  }

  /** «N задач / задача / задачи» — с числом, для подписей виджета. */
  fun plural(n: Int): String = "$n ${pluralShort(n)}"

  private val RU = Locale("ru")

  /** «11 авг» — для заголовков. */
  fun formatDay(epochDay: Long): String {
    val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    cal.timeInMillis = epochDay * 86_400_000L
    return String.format(RU, "%d %s", cal.get(Calendar.DAY_OF_MONTH),
      arrayOf("янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")[cal.get(Calendar.MONTH)])
  }

  /** «Пн» — короткий день недели с заглавной. */
  fun weekdayShort(epochDay: Long): String {
    val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    cal.timeInMillis = epochDay * 86_400_000L
    return arrayOf("Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб")[cal.get(Calendar.DAY_OF_WEEK) - 1]
  }

  /** «09:00» из минут. */
  fun timeLabel(minutes: Int): String =
    String.format(RU, "%02d:%02d", minutes / 60, minutes % 60)

  /** dp → px (для высоты строк виджета при переполнении). */
  fun dp(context: Context, v: Float): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, context.resources.displayMetrics).toInt()
}
