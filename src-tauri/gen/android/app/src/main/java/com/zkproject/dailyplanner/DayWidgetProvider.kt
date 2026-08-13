package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Сегодня» (4×2): заголовок с датой и счётчиком, кнопка «＋»,
 * до 4 задач (время — акцентом, выполненные — зачёркнуты). Если файл
 * устарел (date ≠ сегодня) — заголовок честно показывает дату из данных.
 */
class DayWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_day
  override val refreshAction: String = REFRESH_ACTION

  override fun buildViews(context: Context, data: WidgetData.Payload?): RemoteViews {
    val v = RemoteViews(context.packageName, layoutRes)
    applyCommon(v, context, data)
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "today"))

    val timeIds = listOf(R.id.task_time1, R.id.task_time2, R.id.task_time3, R.id.task_time4)
    val titleIds = listOf(R.id.task_title1, R.id.task_title2, R.id.task_title3, R.id.task_title4)

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

    v.setTextViewText(R.id.widget_title, if (stale) "Задачи · $dateLabel" else "Сегодня")
    v.setTextViewText(
      R.id.widget_subtitle,
      when {
        data.tasks.isEmpty() -> "Нет задач на сегодня"
        pending == 0 -> "$dateLabel · все выполнены"
        else -> "$dateLabel · ${WidgetData.plural(pending)}"
      },
    )

    for (i in timeIds.indices) {
      applyTaskRow(v, timeIds[i], titleIds[i], data.tasks.getOrNull(i), pal, context)
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_DAY"
  }
}
