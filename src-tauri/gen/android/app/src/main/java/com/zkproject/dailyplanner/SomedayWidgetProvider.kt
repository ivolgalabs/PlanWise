package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Когда-нибудь» (4×2): задачи без даты (до 5 строк). Кнопка «＋»
 * открывает быстрый ввод сразу с выбранным чипом «Когда-нибудь».
 */
class SomedayWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_someday
  override val refreshAction: String = REFRESH_ACTION

  override fun buildViews(context: Context, data: WidgetData.Payload?): RemoteViews {
    val v = RemoteViews(context.packageName, layoutRes)
    applyCommon(v, context, data)
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "someday"))

    val timeIds = listOf(R.id.task_time1, R.id.task_time2, R.id.task_time3, R.id.task_time4, R.id.task_time5)
    val titleIds = listOf(R.id.task_title1, R.id.task_title2, R.id.task_title3, R.id.task_title4, R.id.task_title5)

    if (data == null) {
      v.setTextViewText(R.id.widget_title, "Когда-нибудь")
      v.setTextViewText(R.id.widget_subtitle, "Откройте приложение, чтобы загрузить данные")
      timeIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      titleIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val pending = data.someday.count { !it.isDone }
    v.setTextViewText(
      R.id.widget_subtitle,
      when {
        data.someday.isEmpty() -> "Нет задач"
        pending == 0 -> "Все выполнены"
        else -> "${WidgetData.plural(data.someday.size)} · осталось $pending"
      },
    )

    for (i in timeIds.indices) {
      applyTaskRow(v, timeIds[i], titleIds[i], data.someday.getOrNull(i), pal, context)
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_SOMEDAY"
  }
}
