package com.zkproject.dailyplanner

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import android.widget.Toast

/**
 * Быстрое добавление задачи из виджета: лёгкий диалог (название + чипы даты),
 * без запуска WebView и основного интерфейса. Задача пишется напрямую в SQLite
 * (те же defaults, что у Rust-команды upsert_task), widget.json перегенерируется
 * и виджеты обновляются мгновенно. Открывается кнопкой «＋» в виджетах.
 */
class QuickAddActivity : Activity() {

  private var mode = WidgetData.QuickMode.TODAY
  private var saving = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.quick_add)

    mode = when (intent?.getStringExtra(EXTRA_MODE)) {
      "tomorrow" -> WidgetData.QuickMode.TOMORROW
      "someday" -> WidgetData.QuickMode.SOMEDAY
      else -> WidgetData.QuickMode.TODAY
    }
    // Высота окна — по контенту (карточка в центре, остальное затемнено).
    window.setLayout(
      (resources.displayMetrics.widthPixels * 0.92).toInt(),
      android.view.WindowManager.LayoutParams.WRAP_CONTENT,
    )

    val title = findViewById<android.widget.EditText>(R.id.qa_title)
    val chipToday = findViewById<TextView>(R.id.qa_chip_today)
    val chipTomorrow = findViewById<TextView>(R.id.qa_chip_tomorrow)
    val chipSomeday = findViewById<TextView>(R.id.qa_chip_someday)
    val save = findViewById<TextView>(R.id.qa_save)
    val cancel = findViewById<TextView>(R.id.qa_cancel)

    fun selectChip(m: WidgetData.QuickMode) {
      mode = m
      // Выбранный чип — акцентный фон, остальные — нейтральные.
      val selBg = R.drawable.widget_chip_selected
      val plainBg = R.drawable.widget_chip
      chipToday.setBackgroundResource(if (m == WidgetData.QuickMode.TODAY) selBg else plainBg)
      chipTomorrow.setBackgroundResource(if (m == WidgetData.QuickMode.TOMORROW) selBg else plainBg)
      chipSomeday.setBackgroundResource(if (m == WidgetData.QuickMode.SOMEDAY) selBg else plainBg)
      val selColor = getColor(R.color.widget_on_accent)
      val plainColor = getColor(R.color.qa_secondary)
      chipToday.setTextColor(if (m == WidgetData.QuickMode.TODAY) selColor else plainColor)
      chipTomorrow.setTextColor(if (m == WidgetData.QuickMode.TOMORROW) selColor else plainColor)
      chipSomeday.setTextColor(if (m == WidgetData.QuickMode.SOMEDAY) selColor else plainColor)
    }
    selectChip(mode)

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
    val error = WidgetData.addQuickTask(this, text, mode)
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
  }
}
