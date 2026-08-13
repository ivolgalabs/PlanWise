package com.zkproject.dailyplanner

import android.app.Activity
import android.app.DatePickerDialog
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import android.widget.Toast
import java.util.Calendar
import java.util.TimeZone

/**
 * Быстрое добавление задачи из виджета: лёгкий диалог (название + чипы даты),
 * без запуска WebView и основного интерфейса. Задача пишется напрямую в SQLite
 * (те же defaults, что у Rust-команды upsert_task), widget.json перегенерируется
 * и виджеты обновляются мгновенно. Открывается кнопкой «＋» в виджетах; чип
 * «Другая дата» — календарь, EXTRA_DATE — день, показанный в виджете
 * (стрелки ‹ › «Сегодня»), сохраняется как пресет.
 */
class QuickAddActivity : Activity() {

  private var mode = WidgetData.QuickMode.TODAY
  private var exactDay: Long? = null
  private var saving = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.quick_add)

    // День из виджета (стрелки «Сегодня»): если это сегодня/завтра — просто
    // выбираем чип, иначе — «Другая дата» с этой датой.
    val today = WidgetData.todayEpochDay()
    val extraDate = intent?.getLongExtra(EXTRA_DATE, -1L)?.takeIf { it >= 0 }
    mode = when {
      extraDate == today -> WidgetData.QuickMode.TODAY
      extraDate == today + 1 -> WidgetData.QuickMode.TOMORROW
      extraDate != null -> WidgetData.QuickMode.EXACT
      else -> when (intent?.getStringExtra(EXTRA_MODE)) {
        "tomorrow" -> WidgetData.QuickMode.TOMORROW
        "someday" -> WidgetData.QuickMode.SOMEDAY
        else -> WidgetData.QuickMode.TODAY
      }
    }
    exactDay = if (mode == WidgetData.QuickMode.EXACT) extraDate else null
    // Высота окна — по контенту (карточка в центре, остальное затемнено).
    window.setLayout(
      (resources.displayMetrics.widthPixels * 0.92).toInt(),
      android.view.WindowManager.LayoutParams.WRAP_CONTENT,
    )

    val title = findViewById<android.widget.EditText>(R.id.qa_title)
    val chipToday = findViewById<TextView>(R.id.qa_chip_today)
    val chipTomorrow = findViewById<TextView>(R.id.qa_chip_tomorrow)
    val chipSomeday = findViewById<TextView>(R.id.qa_chip_someday)
    val chipDate = findViewById<TextView>(R.id.qa_chip_date)
    val save = findViewById<TextView>(R.id.qa_save)
    val cancel = findViewById<TextView>(R.id.qa_cancel)

    val chips = listOf(
      chipToday to WidgetData.QuickMode.TODAY,
      chipTomorrow to WidgetData.QuickMode.TOMORROW,
      chipSomeday to WidgetData.QuickMode.SOMEDAY,
      chipDate to WidgetData.QuickMode.EXACT,
    )

    fun selectChip(m: WidgetData.QuickMode) {
      mode = m
      // Выбранный чип — акцентный фон, остальные — нейтральные.
      val selBg = R.drawable.widget_chip_selected
      val plainBg = R.drawable.widget_chip
      val selColor = getColor(R.color.widget_on_accent)
      val plainColor = getColor(R.color.qa_secondary)
      for ((chip, cm) in chips) {
        chip.setBackgroundResource(if (cm == m) selBg else plainBg)
        chip.setTextColor(if (cm == m) selColor else plainColor)
      }
      // Название чипа «Другая дата» меняется на выбранный день.
      if (m == WidgetData.QuickMode.EXACT) {
        chipDate.text = exactDay?.let { WidgetData.formatDay(it) } ?: getString(R.string.quick_add_other_date)
      }
    }
    selectChip(mode)

    // «Другая дата»: календарь; выбранный день (epoch-day) пишется в задачу.
    chipDate.setOnClickListener {
      val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
      cal.clear()
      cal.timeInMillis = (exactDay ?: today) * 86_400_000L
      DatePickerDialog(
        this,
        { _, y, m, d ->
          val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
          utc.clear()
          utc.set(y, m, d)
          exactDay = utc.timeInMillis / 86_400_000L
          selectChip(WidgetData.QuickMode.EXACT)
        },
        cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH),
      ).show()
    }

    // Кнопка «Добавить» активна, только когда введено название.
    save.isEnabled = false
    save.alpha = 0.5f
    title.addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
      override fun afterTextChanged(s: Editable?) {
        val has = !s.isNullOrBlank()
        save.isEnabled = has
        save.alpha = if (has) 1f else 0.5f
      }
    })

    chipToday.setOnClickListener { selectChip(WidgetData.QuickMode.TODAY) }
    chipTomorrow.setOnClickListener { selectChip(WidgetData.QuickMode.TOMORROW) }
    chipSomeday.setOnClickListener { selectChip(WidgetData.QuickMode.SOMEDAY) }

    // Enter на клавиатуре — сохранить (как кнопка «Добавить»).
    title.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_DONE) {
        doSave(title)
        true
      } else false
    }

    save.setOnClickListener { doSave(title) }
    cancel.setOnClickListener { finish() }
  }

  private fun doSave(title: android.widget.EditText) {
    if (saving) return
    val text = title.text.toString().trim()
    if (text.isEmpty()) {
      Toast.makeText(this, getString(R.string.quick_add_empty), Toast.LENGTH_SHORT).show()
      return
    }
    saving = true
    val error = WidgetData.addQuickTask(this, text, mode, exactDay)
    if (error == null) {
      // Успех: показываем подтверждение и закрываем диалог.
      Toast.makeText(this, getString(R.string.quick_add_ok), Toast.LENGTH_SHORT).show()
      finish()
    } else {
      // Ошибка БД: предлагаем открыть приложение (миграции накатывает Rust).
      Toast.makeText(
        this,
        if (error == "DB_MISSING") getString(R.string.quick_add_db_missing) else error,
        Toast.LENGTH_LONG,
      ).show()
      saving = false
    }
  }

  companion object {
    const val EXTRA_MODE = "mode"
    /** Epoch-day, показанный в виджете «Сегодня» (стрелки ‹ ›). */
    const val EXTRA_DATE = "date"
  }
}
