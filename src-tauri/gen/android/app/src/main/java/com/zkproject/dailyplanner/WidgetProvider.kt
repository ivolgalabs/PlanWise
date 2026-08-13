package com.zkproject.dailyplanner

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.widget.RemoteViews

/**
 * База всех виджетов приложения: читает files/widget.json (пишет Rust-команда
 * write_widget_data), рендерит по теме приложения (dark из JSON, а не по
 * системной теме) и самообновляется каждые 15 минут через AlarmManager —
 * когда процесс приложения убит, виджет всё равно получает свежие данные
 * (например, после смены дня). Три виджета: «Сегодня» (4×2), «Неделя» (4×4),
 * «Когда-нибудь» (4×2) — тонкие наследники с собственным layout.
 */
abstract class WidgetProvider : AppWidgetProvider() {

  /** Layout виджета (RemoteViews). */
  protected abstract val layoutRes: Int

  /** Уникальный action самообновления для этого типа виджета. */
  protected abstract val refreshAction: String

  /** Собрать RemoteViews из данных (или состояния «нет данных»). */
  protected abstract fun buildViews(context: Context, data: WidgetData.Payload?): RemoteViews

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val data = WidgetData.readFile(context)
    for (id in ids) {
      manager.updateAppWidget(id, buildViews(context, data))
    }
    scheduleSelfRefresh(context)
  }

  override fun onEnabled(context: Context) {
    // Виджет добавлен на экран — запускаем самообновление.
    scheduleSelfRefresh(context)
  }

  override fun onDisabled(context: Context) {
    // Последний виджет этого типа убран — останавливаем таймер.
    cancelSelfRefresh(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      refreshAction -> {
        // Таймер самообновления: перечитать widget.json и перерисоваться.
        updateAll(context)
      }
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
        // После перезагрузки/обновления Android сбрасывает повторяющиеся
        // будильники — восстанавливаем самообновление и показываем данные.
        scheduleSelfRefresh(context)
        updateAll(context)
      }
      else -> super.onReceive(context, intent)
    }
  }

  private fun scheduleSelfRefresh(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = selfRefreshPendingIntent(context)
    // Inexact: система группирует с другими будильниками — батарея не тратится.
    val interval = 15L * 60 * 1000
    am.setInexactRepeating(
      AlarmManager.RTC,
      System.currentTimeMillis() + interval,
      interval,
      pi,
    )
  }

  private fun cancelSelfRefresh(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(selfRefreshPendingIntent(context))
  }

  private fun selfRefreshPendingIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REFRESH_REQUEST_CODE,
      Intent(context, this.javaClass).setAction(refreshAction),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  companion object {
    private const val REFRESH_REQUEST_CODE = 73001

    /** Открыть приложение тапом по виджету. */
    @JvmStatic
    fun openAppPendingIntent(context: Context): PendingIntent =
      PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    /** Кнопка «＋»: диалог быстрого добавления с предвыбранной датой. */
    @JvmStatic
    fun quickAddPendingIntent(context: Context, mode: String): PendingIntent {
      val i = Intent(context, QuickAddActivity::class.java).putExtra(QuickAddActivity.EXTRA_MODE, mode)
      return PendingIntent.getActivity(
        context, mode.hashCode(), i,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Перечитать widget.json и обновить ВСЕ виджеты всех трёх типов.
     *  Вызывается из push-плагина (Rust) и после быстрого добавления. */
    @JvmStatic
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val data = WidgetData.readFile(context)
      val providers = listOf(
        DayWidgetProvider::class.java,
        WeekWidgetProvider::class.java,
        SomedayWidgetProvider::class.java,
      )
      for (cls in providers) {
        val ids = manager.getAppWidgetIds(ComponentName(context, cls))
        if (ids.isEmpty()) continue
        val provider = cls.getDeclaredConstructor().newInstance() as WidgetProvider
        for (id in ids) {
          manager.updateAppWidget(id, provider.buildViews(context, data))
        }
      }
    }

    /** Общая настройка корня: клик → приложение; фон по теме из данных. */
    @JvmStatic
    protected fun applyCommon(
      v: RemoteViews,
      context: Context,
      data: WidgetData.Payload?,
    ) {
      v.setOnClickPendingIntent(R.id.widget_root, openAppPendingIntent(context))
      val dark = data?.dark ?: false
      val pal = WidgetData.palette(dark, context.resources)
      v.setInt(R.id.widget_root, "setBackgroundResource", pal.bgRes)
      v.setTextColor(R.id.widget_title, pal.text)
      v.setTextColor(R.id.widget_subtitle, pal.muted)
      v.setInt(R.id.widget_add, "setBackgroundResource", R.drawable.widget_add_bg)
      v.setTextColor(R.id.widget_add, context.getColor(R.color.widget_on_accent))
    }

    /** Строка задачи: время (акцент) + название; done — зачёркнуто/приглушено. */
    @JvmStatic
    protected fun applyTaskRow(
      v: RemoteViews,
      timeId: Int,
      titleId: Int,
      task: WidgetData.WTask?,
      pal: WidgetData.Palette,
      context: Context,
    ) {
      if (task == null) {
        v.setViewVisibility(timeId, android.view.View.GONE)
        v.setViewVisibility(titleId, android.view.View.GONE)
        return
      }
      v.setViewVisibility(timeId, android.view.View.VISIBLE)
      v.setViewVisibility(titleId, android.view.View.VISIBLE)
      if (task.timeMinutes != null) {
        v.setTextViewText(timeId, WidgetData.timeLabel(task.timeMinutes))
        v.setTextColor(timeId, pal.accent)
      } else {
        v.setTextViewText(timeId, "")
      }
      v.setTextViewText(titleId, task.title)
      v.setTextColor(titleId, if (task.isDone) pal.muted else pal.text)
      // setPaintFlags заменяет ВСЕ флаги — возвращаем антиалиасинг вместе
      // с зачёркиванием (иначе шрифт теряет сглаживание).
      v.setInt(
        titleId, "setPaintFlags",
        if (task.isDone) Paint.ANTI_ALIAS_FLAG or Paint.STRIKE_THRU_TEXT_FLAG
        else Paint.ANTI_ALIAS_FLAG,
      )
      // setAlpha(int) удалён в Android 15+ (остался только float-вариант) —
      // RemoteViews искал бы отсутствующий метод и рушил inflate виджета.
      v.setFloat(timeId, "setAlpha", if (task.isDone) 0.5f else 1.0f)
      v.setFloat(titleId, "setAlpha", if (task.isDone) 0.7f else 1.0f)
    }
  }
}
