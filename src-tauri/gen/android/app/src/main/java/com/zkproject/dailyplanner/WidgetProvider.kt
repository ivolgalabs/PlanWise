package com.zkproject.dailyplanner

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Виджет «Задачи на день»: показывает список задач на сегодня из
 * files/widget.json, который пишет Rust-команда write_widget_data
 * (обновляется при каждой перезагрузке задач и по системному таймеру
 * виджета — android:updatePeriodMillis).
 */
class WidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val data = readWidgetData(context)
    for (id in appWidgetIds) {
      val views = buildViews(context, data)
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  /** Читает files/widget.json: {"date": N, "tasks": [{title, timeMinutes, isDone}]} */
  private fun readWidgetData(context: Context): JSONObject? {
    return try {
      val f = java.io.File(context.filesDir, "widget.json")
      if (!f.exists()) null else JSONObject(f.readText())
    } catch (e: Exception) {
      null
    }
  }

  private fun buildViews(context: Context, data: JSONObject?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_layout)
    // Тап по виджету — открыть приложение.
    val open = Intent(context, MainActivity::class.java)
    val pi = PendingIntent.getActivity(
      context, 0, open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setOnClickPendingIntent(R.id.widget_root, pi)

    val tasks = data?.optJSONArray("tasks") ?: return views
    if (tasks.length() == 0) {
      views.setTextViewText(R.id.widget_title, "Нет задач на сегодня")
      hideTaskRows(views)
      return views
    }

    val pending = (0 until tasks.length()).count { !tasks.getJSONObject(it).optBoolean("isDone") }
    views.setTextViewText(R.id.widget_title, "Задачи на сегодня ($pending)")
    val ids = listOf(
      R.id.widget_task1, R.id.widget_task2, R.id.widget_task3,
      R.id.widget_task4, R.id.widget_task5, R.id.widget_task6
    )
    for (i in ids.indices) {
      if (i < tasks.length()) {
        val t = tasks.getJSONObject(i)
        val done = t.optBoolean("isDone")
        val time = t.optInt("timeMinutes", -1)
        val label = if (time >= 0) {
          val h = time / 60
          val m = time % 60
          "${if (h < 10) "0$h" else h}:${if (m < 10) "0$m" else m}  ${t.optString("title")}"
        } else {
          t.optString("title")
        }
        views.setTextViewText(ids[i], label)
        views.setInt(ids[i], "setAlpha", if (done) 100 else 255)
        views.setViewVisibility(ids[i], android.view.View.VISIBLE)
      } else {
        views.setViewVisibility(ids[i], android.view.View.GONE)
      }
    }
    return views
  }

  private fun hideTaskRows(views: RemoteViews) {
    val ids = listOf(
      R.id.widget_task1, R.id.widget_task2, R.id.widget_task3,
      R.id.widget_task4, R.id.widget_task5, R.id.widget_task6
    )
    for (id in ids) views.setViewVisibility(id, android.view.View.GONE)
  }
}
