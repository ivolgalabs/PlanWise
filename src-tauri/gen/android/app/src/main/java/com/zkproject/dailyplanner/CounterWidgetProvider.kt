package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Мини-счётчик» (1×1): сколько невыполненных задач осталось на
 * сегодня. Всё сделано — галочка «✓». Тап открывает приложение.
 */
class CounterWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_counter
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

    if (data == null) {
      v.setTextViewText(R.id.widget_counter_num, "—")
      v.setTextViewText(R.id.widget_counter_label, "нет данных")
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val pending = data.tasks.count { !it.isDone }
    if (pending == 0) {
      // Всё выполнено: галочка акцентом + подпись «готово».
      v.setTextViewText(R.id.widget_counter_num, "✓")
      v.setTextColor(R.id.widget_counter_num, pal.accent)
      v.setTextViewText(R.id.widget_counter_label, "готово")
    } else {
      v.setTextViewText(R.id.widget_counter_num, pending.toString())
      v.setTextColor(R.id.widget_counter_num, pal.accent)
      v.setTextViewText(R.id.widget_counter_label, WidgetData.pluralShort(pending))
    }
    return v
  }

  companion object {
    const val REFRESH_ACTION = "com.zkproject.dailyplanner.REFRESH_COUNTER"
  }
}
