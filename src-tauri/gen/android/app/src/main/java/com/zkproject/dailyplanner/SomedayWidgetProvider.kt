package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Когда-нибудь»: задачи без даты, адаптация к размеру как у «Сегодня»
 * (2×2 — 2 строки, 4×2 — 5 строк, 4×3+ — 7 строк). Тап по строке отмечает
 * задачу выполненной. Кнопка «＋» открывает быстрый ввод сразу с выбранным
 * чипом «Когда-нибудь».
 */
class SomedayWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_someday
  override val refreshAction: String = REFRESH_ACTION

  override fun buildViews(
    context: Context,
    data: WidgetData.Payload?,
    widthDp: Int,
    heightDp: Int,
    appWidgetId: Int,
  ): RemoteViews {
    val v = RemoteViews(context.packageName, layoutRes)
    applyCommon(v, context, data)
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "someday"))

    val timeIds = listOf(
      R.id.task_time1, R.id.task_time2, R.id.task_time3, R.id.task_time4,
      R.id.task_time5, R.id.task_time6, R.id.task_time7,
    )
    val titleIds = listOf(
      R.id.task_title1, R.id.task_title2, R.id.task_title3, R.id.task_title4,
      R.id.task_title5, R.id.task_title6, R.id.task_title7,
    )

    if (data == null) {
      v.setTextViewText(R.id.widget_title, "Когда-нибудь")
      v.setTextViewText(R.id.widget_subtitle, "Откройте приложение, чтобы загрузить данные")
      timeIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      titleIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val pending = data.someday.count { !it.isDone }

    val rows = when {
      widthDp >= 240 && heightDp >= 170 -> 7
      widthDp >= 240 -> 5
      heightDp >= 170 -> 3
      else -> 2
    }
    val showTime = widthDp >= 240
    val showSubtitle = heightDp >= 120

    v.setTextViewText(
      R.id.widget_subtitle,
      when {
        data.someday.isEmpty() -> "Нет задач"
        pending == 0 -> "Все выполнены"
        else -> "${WidgetData.plural(data.someday.size)} · осталось $pending"
      },
    )
    v.setViewVisibility(R.id.widget_subtitle, if (showSubtitle) android.view.View.VISIBLE else android.view.View.GONE)

    for (i in timeIds.indices) {
      if (i < rows) {
        val task = data.someday.getOrNull(i)
        applyTaskRow(
          v, timeIds[i], titleIds[i], task, pal, context, showTime,
          clickPi = if (task != null) togglePendingIntent(context, task.id) else null,
        )
      } else {
        v.setViewVisibility(timeIds[i], android.view.View.GONE)
        v.setViewVisibility(titleIds[i], android.view.View.GONE)
      }
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_SOMEDAY"
  }
}
