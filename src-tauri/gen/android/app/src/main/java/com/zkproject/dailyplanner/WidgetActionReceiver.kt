package com.zkproject.dailyplanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Действия виджетов, которые меняют данные: тап по строке = отметить задачу
 * выполненной (UPDATE в SQLite + перерисовка), стрелки ‹ › = переключить
 * показанный день конкретного виджета, тап по дате = вернуться на сегодня.
 * Отдельный receiver — PendingIntent'ы из RemoteViews не могут вызывать
 * методы AppWidgetProvider напрямую.
 */
class WidgetActionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_DAY_NAV -> {
        val id = intent.getIntExtra(EXTRA_APPWIDGET_ID, -1)
        val delta = intent.getIntExtra(EXTRA_DELTA, 0)
        if (id >= 0) {
          // Окно данных виджета — вчера..+13 (dayWindow), за границы не выходим.
          val off = (WidgetProvider.dayOffset(context, id) + delta).coerceIn(-1, 13)
          WidgetProvider.setDayOffset(context, id, off)
          WidgetProvider.updateAll(context)
        }
      }

      ACTION_DAY_RESET -> {
        val id = intent.getIntExtra(EXTRA_APPWIDGET_ID, -1)
        if (id >= 0) {
          WidgetProvider.setDayOffset(context, id, 0)
          WidgetProvider.updateAll(context)
        }
      }

      ACTION_TOGGLE -> {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID)
        if (taskId != null) {
          // Ошибку не показываем (receiver), тихо логируем — следующий
          // самообновление/тик приложения приведёт виджет в порядок.
          WidgetData.toggleTaskDone(context, taskId)
        }
      }
    }
  }

  companion object {
    const val ACTION_DAY_NAV = "com.zkproject.dailyplanner.DAY_NAV"
    const val ACTION_DAY_RESET = "com.zkproject.dailyplanner.DAY_RESET"
    const val ACTION_TOGGLE = "com.zkproject.dailyplanner.TOGGLE_DONE"
    const val EXTRA_APPWIDGET_ID = "appWidgetId"
    const val EXTRA_DELTA = "delta"
    const val EXTRA_TASK_ID = "taskId"
  }
}
