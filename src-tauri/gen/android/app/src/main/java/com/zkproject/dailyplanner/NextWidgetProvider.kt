package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews
import java.util.Calendar

/**
 * Виджет «Следующая задача» (2×1): ближайшая по времени задача на сегодня.
 * Сначала — невыполненные задачи с временем в будущем (по времени), затем —
 * просто первая невыполненная, иначе «Все выполнены» / «Нет задач». Тап по
 * виджету открывает приложение, «＋» — быстрый ввод на сегодня.
 */
class NextWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_next
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
    v.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent(context, "today"))

    if (data == null || data.tasks.isEmpty()) {
      v.setTextViewText(R.id.widget_next_title, if (data == null) "Откройте приложение" else "Нет задач на сегодня")
      v.setViewVisibility(R.id.widget_next_time, android.view.View.GONE)
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val nowMin = Calendar.getInstance().let {
      it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
    }
    val pending = data.tasks.filter { !it.isDone }
    // Ближайшая задача: с временем в будущем (по времени), иначе — первая
    // невыполненная (в порядке из приложения). Все выполнены — next = null.
    val next = if (pending.isEmpty()) null
    else pending.filter { it.timeMinutes != null && it.timeMinutes!! >= nowMin }
      .minByOrNull { it.timeMinutes!! }
      ?: pending.firstOrNull()

    if (next == null) {
      v.setTextViewText(R.id.widget_next_title, "Все выполнены ✓")
      v.setTextColor(R.id.widget_next_title, pal.accent)
      v.setViewVisibility(R.id.widget_next_time, android.view.View.GONE)
      return v
    }

    val tm = next.timeMinutes
    v.setViewVisibility(R.id.widget_next_time, if (tm != null) android.view.View.VISIBLE else android.view.View.GONE)
    if (tm != null) {
      v.setTextViewText(R.id.widget_next_time, WidgetData.timeLabel(tm))
      v.setTextColor(R.id.widget_next_time, pal.accent)
    }
    v.setTextViewText(R.id.widget_next_title, next.title)
    v.setTextColor(R.id.widget_next_title, if (next.isDone) pal.muted else pal.text)
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_NEXT"
  }
}
