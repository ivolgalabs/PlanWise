package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Сегодня»: заголовок с датой и счётчиком, кнопка «＋», до 6 задач
 * (время — акцентом, выполненные — зачёркнуты). Адаптируется к размеру:
 * 2×2 — 2 строки без времени, 4×2 — 4 строки, 4×3+ — 6 строк. Если файл
 * устарел (date ≠ сегодня) — заголовок честно показывает дату из данных.
 */
class DayWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_day
  override val refreshAction: String = REFRESH_ACTION

  override fun buildViews(
    context: Context,
    data: WidgetData.Payload?,
    widthDp: Int,
    heightDp: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, layoutRes)
    applyCommon(v, context, data)
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "today"))

    val timeIds = listOf(
      R.id.task_time1, R.id.task_time2, R.id.task_time3, R.id.task_time4,
      R.id.task_time5, R.id.task_time6,
    )
    val titleIds = listOf(
      R.id.task_title1, R.id.task_title2, R.id.task_title3, R.id.task_title4,
      R.id.task_title5, R.id.task_title6,
    )

    if (data == null) {
      v.setTextViewText(R.id.widget_title, "Задачи на сегодня")
      v.setTextViewText(R.id.widget_subtitle, "Откройте приложение, чтобы загрузить данные")
      timeIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      titleIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val today = WidgetData.todayEpochDay()
    val stale = data.date != today
    val pending = data.tasks.count { !it.isDone }
    val dateLabel = WidgetData.formatDay(data.date)

    // Сколько строк влезает: по ширине (2/3/4 колонки) и высоте (2/3 клетки).
    val rows = when {
      widthDp >= 240 && heightDp >= 170 -> 6
      widthDp >= 240 -> 4
      widthDp >= 150 -> 3
      else -> 2
    }
    val showTime = widthDp >= 240
    val showSubtitle = heightDp >= 120

    v.setTextViewText(R.id.widget_title, if (stale) "Задачи · $dateLabel" else "Сегодня")
    v.setTextViewText(
      R.id.widget_subtitle,
      when {
        data.tasks.isEmpty() -> "Нет задач на сегодня"
        pending == 0 -> "$dateLabel · все выполнены"
        else -> "$dateLabel · ${WidgetData.plural(pending)}"
      },
    )
    v.setViewVisibility(R.id.widget_subtitle, if (showSubtitle) android.view.View.VISIBLE else android.view.View.GONE)

    for (i in timeIds.indices) {
      if (i < rows) {
        val task = data.tasks.getOrNull(i)
        applyTaskRow(v, timeIds[i], titleIds[i], task, pal, context, showTime)
      } else {
        v.setViewVisibility(timeIds[i], android.view.View.GONE)
        v.setViewVisibility(titleIds[i], android.view.View.GONE)
      }
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_DAY"
  }
}
