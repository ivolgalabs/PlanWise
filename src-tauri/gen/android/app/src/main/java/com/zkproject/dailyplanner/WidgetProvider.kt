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
 * (например, после смены дня). Пять виджетов: «Сегодня» (интерактивный —
 * стрелки ‹ › переключают день, тап по строке отмечает выполненной),
 * «Неделя», «Когда-нибудь», «Следующая задача», «Мини-счётчик» — тонкие
 * наследники с собственным layout.
 *
 * Все виджеты АДАПТИВНЫ: содержимое подстраивается под фактический размер
 * (onAppWidgetOptionsChanged / getAppWidgetOptions) — в маленьком виде меньше
 * строк, в большом — больше, время — только в широких размерах.
 */
abstract class WidgetProvider : AppWidgetProvider() {

  /** Layout виджета (RemoteViews). */
  protected abstract val layoutRes: Int

  /** Уникальный action самообновления для этого типа виджета. */
  protected abstract val refreshAction: String

  /** Собрать RemoteViews из данных (или состояния «нет данных»).
   *  widthDp/heightDp — фактический размер виджета в dp (клетки лаунчера);
   *  appWidgetId — для индивидуальных настроек виджета (показанный день). */
  protected abstract fun buildViews(
    context: Context,
    data: WidgetData.Payload?,
    widthDp: Int,
    heightDp: Int,
    appWidgetId: Int,
  ): RemoteViews

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val data = WidgetData.readFile(context)
    for (id in ids) {
      val (w, h) = widgetSize(manager, id)
      manager.updateAppWidget(id, buildViews(context, data, w, h, id))
    }
    scheduleSelfRefresh(context)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    super.onAppWidgetOptionsChanged(context, manager, appWidgetId, newOptions)
    // Пользователь растянул/сжал виджет — пересобираем под новый размер.
    val w = newOptions.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
    val h = newOptions.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
    manager.updateAppWidget(appWidgetId, buildViews(context, WidgetData.readFile(context), w, h, appWidgetId))
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

    /** Кнопка «＋»: диалог быстрого добавления с предвыбранной датой.
     *  date — показанный в виджете день (epoch-day), если виджет умеет
     *  переключать дни (стрелки ‹ ›); null — дефолт по чипу. */
    @JvmStatic
    fun quickAddPendingIntent(context: Context, mode: String, date: Long? = null): PendingIntent {
      val i = Intent(context, QuickAddActivity::class.java).putExtra(QuickAddActivity.EXTRA_MODE, mode)
      if (date != null) i.putExtra(QuickAddActivity.EXTRA_DATE, date)
      return PendingIntent.getActivity(
        context, mode.hashCode(), i,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Тап по строке задачи = отметить выполненной/невыполненной. Receiver
     *  делает UPDATE в SQLite и перерисовывает виджеты. data-URI различает
     *  PendingIntent'ы строк (иначе последняя строка перезаписала бы все). */
    @JvmStatic
    fun togglePendingIntent(context: Context, taskId: String): PendingIntent {
      val i = Intent(context, WidgetActionReceiver::class.java)
        .setAction(WidgetActionReceiver.ACTION_TOGGLE)
        .putExtra(WidgetActionReceiver.EXTRA_TASK_ID, taskId)
        .setData(android.net.Uri.parse("task://$taskId"))
      return PendingIntent.getBroadcast(
        context, taskId.hashCode(), i,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Стрелка «‹ ›»: сдвинуть показанный день конкретного виджета. */
    @JvmStatic
    fun dayNavPendingIntent(context: Context, appWidgetId: Int, delta: Int): PendingIntent {
      val i = Intent(context, WidgetActionReceiver::class.java)
        .setAction(WidgetActionReceiver.ACTION_DAY_NAV)
        .putExtra(WidgetActionReceiver.EXTRA_APPWIDGET_ID, appWidgetId)
        .putExtra(WidgetActionReceiver.EXTRA_DELTA, delta)
      return PendingIntent.getBroadcast(
        context, 20000 + appWidgetId * 4 + delta + 1, i,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Тап по дате в заголовке «Дня»: вернуться на сегодня (offset = 0). */
    @JvmStatic
    fun dayResetPendingIntent(context: Context, appWidgetId: Int): PendingIntent {
      val i = Intent(context, WidgetActionReceiver::class.java)
        .setAction(WidgetActionReceiver.ACTION_DAY_RESET)
        .putExtra(WidgetActionReceiver.EXTRA_APPWIDGET_ID, appWidgetId)
      return PendingIntent.getBroadcast(
        context, 30000 + appWidgetId, i,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Сдвиг показанного дня виджета «День» (0 = сегодня, -1 = вчера…).
     *  Хранится в SharedPreferences по appWidgetId — стрелки не переключают
     *  другие экземпляры виджета. */
    @JvmStatic
    fun dayOffset(context: Context, appWidgetId: Int): Int =
      context.getSharedPreferences("widget_day", Context.MODE_PRIVATE)
        .getInt("off_$appWidgetId", 0)

    @JvmStatic
    fun setDayOffset(context: Context, appWidgetId: Int, off: Int) {
      context.getSharedPreferences("widget_day", Context.MODE_PRIVATE)
        .edit().putInt("off_$appWidgetId", off).apply()
    }

    /** Перечитать widget.json и обновить ВСЕ виджеты всех типов.
     *  Вызывается из push-плагина (Rust), после быстрого добавления
     *  и после действий receiver'а (выполнено/стрелки). */
    @JvmStatic
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val data = WidgetData.readFile(context)
      val providers = listOf(
        DayWidgetProvider::class.java,
        WeekWidgetProvider::class.java,
        SomedayWidgetProvider::class.java,
        NextWidgetProvider::class.java,
        CounterWidgetProvider::class.java,
      )
      for (cls in providers) {
        val ids = manager.getAppWidgetIds(ComponentName(context, cls))
        if (ids.isEmpty()) continue
        val provider = cls.getDeclaredConstructor().newInstance() as WidgetProvider
        for (id in ids) {
          val (w, h) = widgetSize(manager, id)
          manager.updateAppWidget(id, provider.buildViews(context, data, w, h, id))
        }
      }
    }

    /** Фактический размер виджета в dp (мин. ширина/высота из опций
     *  AppWidgetManager — их задаёт лаунчер при размещении/ресайзе). */
    @JvmStatic
    fun widgetSize(manager: AppWidgetManager, id: Int): Pair<Int, Int> {
      val o = manager.getAppWidgetOptions(id)
      return o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) to
        o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
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

    /** Строка задачи: время (акцент) + название; done — зачёркнуто/приглушено.
     *  showTime=false (маленький виджет) — время скрыто, название на всю ширину.
     *  clickPi — тап по строке отмечает задачу выполненной (виджеты «День»
     *  и «Когда-нибудь»); null — строка не кликабельна. */
    @JvmStatic
    protected fun applyTaskRow(
      v: RemoteViews,
      timeId: Int,
      titleId: Int,
      task: WidgetData.WTask?,
      pal: WidgetData.Palette,
      _context: Context,
      showTime: Boolean = true,
      clickPi: PendingIntent? = null,
    ) {
      if (task == null) {
        v.setViewVisibility(timeId, android.view.View.GONE)
        v.setViewVisibility(titleId, android.view.View.GONE)
        return
      }
      v.setViewVisibility(timeId, if (showTime && task.timeMinutes != null) android.view.View.VISIBLE else android.view.View.GONE)
      v.setViewVisibility(titleId, android.view.View.VISIBLE)
      if (clickPi != null) {
        // Клик по тексту строки (время + название) = переключить «выполнено».
        v.setOnClickPendingIntent(timeId, clickPi)
        v.setOnClickPendingIntent(titleId, clickPi)
      }
      if (showTime && task.timeMinutes != null) {
        v.setTextViewText(timeId, WidgetData.timeLabel(task.timeMinutes))
        v.setTextColor(timeId, pal.accent)
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
