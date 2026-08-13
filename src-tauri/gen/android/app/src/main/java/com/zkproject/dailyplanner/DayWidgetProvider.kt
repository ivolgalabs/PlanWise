package com.zkproject.dailyplanner

import android.content.Context
import android.widget.RemoteViews

/**
 * Виджет «Сегодня» (интерактивный «День»): заголовок с датой и счётчиком,
 * стрелки ‹ › переключают показанный день (вчера..+5 из dayWindow), тап по
 * дате возвращает на сегодня, тап по строке отмечает задачу выполненной,
 * кнопка «＋» добавляет задачу на показанный день. Прогресс-бар показывает
 * долю выполненных задач дня. Адаптируется к размеру: 2×2 — 2-3 строки без
 * времени, 4×2 — 4 строки, 4×3+ — 6 строк.
 */
class DayWidgetProvider : WidgetProvider() {

  override val layoutRes: Int = R.layout.widget_day
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
      v.setViewVisibility(R.id.widget_progress, android.view.View.GONE)
      v.setViewVisibility(R.id.widget_prev, android.view.View.GONE)
      v.setViewVisibility(R.id.widget_next, android.view.View.GONE)
      timeIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      titleIds.forEach { v.setViewVisibility(it, android.view.View.GONE) }
      return v
    }

    val pal = WidgetData.palette(data.dark, context.resources)
    val today = WidgetData.todayEpochDay()
    val stale = data.date != today
    // Стрелки ‹ › — приглушённым цветом темы (в layout — светлый дефолт).
    v.setTextColor(R.id.widget_prev, pal.muted)
    v.setTextColor(R.id.widget_next, pal.muted)

    // Показанный день: 0 = сегодня (data.tasks), иначе — из окна dayWindow.
    // Сдвиг хранится на виджет (SharedPreferences) — у каждого экземпляра
    // свой, стрелки одного виджета не трогают другой. Окно: вчера..+13.
    val off = WidgetProvider.dayOffset(context, appWidgetId).coerceIn(-1, 13)
    val windowDay = data.dayWindow.getOrNull(off + 1)
    val shown: List<WidgetData.WTask> = if (off == 0) data.tasks else windowDay?.tasks ?: emptyList()
    val shownDate: Long = if (off == 0) data.date else windowDay?.date ?: (data.date + off)

    // Сколько строк влезает: по ширине (2/3/4 колонки) и высоте (2/3 клетки).
    val rows = when {
      widthDp >= 240 && heightDp >= 170 -> 6
      widthDp >= 240 -> 4
      heightDp >= 170 -> 3
      else -> 2
    }
    val showTime = widthDp >= 240
    val showSubtitle = heightDp >= 120

    // Заголовок: «Сегодня» (с датой, если файл устарел) или дата дня стрелок.
    v.setTextViewText(
      R.id.widget_title,
      when {
        off != 0 -> WidgetData.formatDay(shownDate)
        stale -> "Задачи · ${WidgetData.formatDay(data.date)}"
        else -> "Сегодня"
      },
    )
    // Тап по дате возвращает виджет на сегодня (на «Сегодня» — нет-op).
    if (off != 0) {
      v.setOnClickPendingIntent(R.id.widget_title, WidgetProvider.dayResetPendingIntent(context, appWidgetId))
      v.setContentDescription(R.id.widget_title, "Вернуться на сегодня")
    }

    val pending = shown.count { !it.isDone }
    v.setTextViewText(
      R.id.widget_subtitle,
      when {
        off != 0 && shown.isEmpty() -> "Нет задач"
        off == 0 && shown.isEmpty() -> if (stale) "${WidgetData.formatDay(shownDate)} · нет задач" else "Нет задач на сегодня"
        pending == 0 -> "${WidgetData.formatDay(shownDate)} · все выполнены"
        else -> "${WidgetData.formatDay(shownDate)} · ${WidgetData.plural(pending)}"
      },
    )
    v.setViewVisibility(R.id.widget_subtitle, if (showSubtitle) android.view.View.VISIBLE else android.view.View.GONE)

    // Стрелки ‹ ›: предыдущий/следующий день; «＋» добавляет на показанный день.
    v.setOnClickPendingIntent(R.id.widget_prev, WidgetProvider.dayNavPendingIntent(context, appWidgetId, -1))
    v.setOnClickPendingIntent(R.id.widget_next, WidgetProvider.dayNavPendingIntent(context, appWidgetId, 1))
    v.setContentDescription(R.id.widget_prev, "Предыдущий день")
    v.setContentDescription(R.id.widget_next, "Следующий день")
    v.setOnClickPendingIntent(R.id.widget_add, WidgetProvider.quickAddPendingIntent(context, "today", shownDate))

    // Прогресс дня: доля выполненных. Пусто — скрыт.
    if (shown.isEmpty()) {
      v.setViewVisibility(R.id.widget_progress, android.view.View.GONE)
    } else {
      v.setViewVisibility(R.id.widget_progress, android.view.View.VISIBLE)
      v.setProgressBar(R.id.widget_progress, shown.size, shown.size - pending, false)
    }

    for (i in timeIds.indices) {
      if (i < rows) {
        val task = shown.getOrNull(i)
        applyTaskRow(
          v, timeIds[i], titleIds[i], task, pal, context, showTime,
          clickPi = if (task != null) WidgetProvider.togglePendingIntent(context, task.id) else null,
        )
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
