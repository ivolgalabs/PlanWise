package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Неделя» (4×4): 7 строк «Пн 11 · 3 задачи». Сегодня — акцент +
 * жирный, прошедшие дни — приглушённые. Кнопка «＋» добавляет на сегодня.
 */
class WeekWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_week
  override val refreshAction: String = REFRESH_ACTION

  override fun buildViews(context: Context, data: WidgetData.Payload?): RemoteViews {
    val v = RemoteViews(context.packageName, layoutRes)
    applyCommon(v, context, data)
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "today"))

    val labelIds = listOf(
      R.id.day_label1, R.id.day_label2, R.id.day_label3, R.id.day_label4,
      R.id.day_label5, R.id.day_label6, R.id.day_label7,
    )
    val countIds = listOf(
      R.id.day_count1, R.id.day_count2, R.id.day_count3, R.id.day_count4,
      R.id.day_count5, R.id.day_count6, R.id.day_count7,
    )

    if (data == null || data.week.isEmpty()) {
      v.setTextViewText(R.id.widget_title, "Неделя")
      v.setTextViewText(R.id.widget_subtitle, "Откройте приложение, чтобы загрузить данные")
      labelIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      countIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val today = WidgetData.todayEpochDay()
    val first = data.week.first().date
    val last = data.week.last().date
    v.setTextViewText(R.id.widget_subtitle, "${WidgetData.formatDay(first)} – ${WidgetData.formatDay(last)}")

    for (i in labelIds.indices) {
      val day = data.week.getOrNull(i)
      if (day == null) {
        labelIds[i].let { v.setViewVisibility(it, android.view.View.GONE) }
        countIds[i].let { v.setViewVisibility(it, android.view.View.GONE) }
        continue
      }
      val isToday = day.date == today
      val isPast = day.date < today
      labelIds[i].let {
        v.setViewVisibility(it, android.view.View.VISIBLE)
        v.setTextViewText(it, "${WidgetData.weekdayShort(day.date)} ${WidgetData.formatDay(day.date)}")
        v.setTextColor(it, if (isToday) pal.accent else if (isPast) pal.muted else pal.secondary)
      }
      countIds[i].let {
        v.setViewVisibility(it, android.view.View.VISIBLE)
        val n = day.tasks.size
        v.setTextViewText(it, if (n == 0) "—" else WidgetData.plural(n))
        v.setTextColor(it, if (isToday) pal.accent else pal.muted)
      }
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_WEEK"
  }
}
