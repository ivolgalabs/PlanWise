package com.zkproject.dailyplanner

import android.app.Activity
import android.content.Context
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/**
 * Аргументы persistScheduled: готовую строку уведомления собирает Rust
 * (sourceJson плагина 2.3.3 не заполняется нигде, поэтому его `batch` кладёт в
 * хранилище "null"). Формат строки — тот, что разбирает jackson плагина.
 */
@InvokeArg
class PersistArgs {
  var id: Int = 0
  var json: String? = null
}

/**
 * Ключ persisted-хранилища плагина уведомлений (приватная константа
 * NOTIFICATION_STORE_ID в его NotificationStorage.kt). Сверить при
 * обновлении tauri-plugin-notification.
 */
private const val NOTIFICATION_STORE = "NOTIFICATION_STORE"

/**
 * Плагин мгновенного обновления виджетов: Rust (write_widget_data) после
 * записи widget.json вызывает команду "refresh" — плагин перечитывает файл
 * и перерисовывает все виджеты. Без этого виджет ждал бы системного
 * обновления до 30 минут. Регистрируется Rust-плагином "widget"
 * (register_android_plugin) — имя класса указывается в lib.rs.
 */
class WidgetPushPlugin(activity: Activity) : Plugin(activity) {
  // Базовый Plugin держит activity приватным — храним свою ссылку.
  private val appContext: Context = activity

  @Command
  fun refresh(invoke: Invoke) {
    try {
      WidgetProvider.updateAll(appContext)
      invoke.resolve()
    } catch (e: Exception) {
      e.printStackTrace()
      invoke.reject(e.message ?: "Ошибка обновления виджета", null as String?)
    }
  }

  /**
   * Свернуть приложение (кнопка «назад» при закрытых модалках): задача
   * уходит в фон через moveTaskToBack, ПРОЦЕСС ОСТАЁТСЯ ЖИВ — следующий
   * запуск из лончера тёплый (WebView уже создан, нет холодного экрана).
   * Полный выход — только «Выйти» в настройках (exit_app).
   */
  @Command
  fun minimize(invoke: Invoke) {
    try {
      val activity = appContext as? Activity
      if (activity == null || activity.isFinishing) {
        invoke.reject("нет активной activity", null as String?)
        return
      }
      activity.runOnUiThread { activity.moveTaskToBack(true) }
      invoke.resolve()
    } catch (e: Exception) {
      e.printStackTrace()
      invoke.reject(e.message ?: "Не удалось свернуть приложение", null as String?)
    }
  }

  /**
   * Записать запланированные уведомления в persisted-хранилище плагина
   * уведомлений — то, что делает команда batch и чего НЕ делает show():
   * будильник show() ставит, но в хранилище не пишет. С пустым хранилищем
   * pending() всегда пуст (guard синхронизации не срабатывает, лишние
   * будильники не отменяются), а BOOT-приёмник плагина после перезагрузки
   * восстанавливает пустой список — все напоминания и дайджест терялись.
   *
   * Пишем строку уведомления напрямую в SharedPreferences плагина (ключ
   * NOTIFICATION_STORE, запись по id — как NotificationStorage.appendNotifications).
   * Классы Notification/ObjectMapper (jackson) при этом не нужны: строку
   * разбирает сам плагин, а sourceJson заполняет parseArgs (на нём же
   * держится и batch плагина).
   */
  @Command
  fun persistScheduled(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PersistArgs::class.java)
      val raw = args.json
      if (raw.isNullOrEmpty()) {
        invoke.reject("пустая строка уведомления", null as String?)
        return
      }
      appContext
        .getSharedPreferences(NOTIFICATION_STORE, Context.MODE_PRIVATE)
        .edit()
        .putString(args.id.toString(), raw)
        .apply()
      // Диагностика хранилища: по этим строкам видно, попала ли запись и что
      // именно лежит в SharedPreferences (логика restore/cancel живёт в Rust).
      Log.w("PlanWise", "persist id=${args.id} len=${raw.length}")
      invoke.resolveObject(args.id)
    } catch (e: Exception) {
      e.printStackTrace()
      invoke.reject(e.message ?: "Не удалось записать уведомление в хранилище", null as String?)
    }
  }

  /**
   * Id уведомлений, лежащих в persisted-хранилище плагина, — это и есть
   * поставленные алармы (publisher удаляет запись при срабатывании, cancel —
   * при отмене). Команда `getPending` плагина отдаёт другое — уведомления,
   * УЖЕ висящие в шторке, поэтому Rust-планировщику нужен этот список.
   */
  @Command
  fun scheduledIds(invoke: Invoke) {
    try {
      val prefs = appContext.getSharedPreferences(NOTIFICATION_STORE, Context.MODE_PRIVATE)
      // Обычный список, а не JSArray: resolveObject сериализует его jackson-ом,
      // а тот отдаёт JSONArray пустым объектом ({}), и Rust получает map вместо
      // массива ("invalid type: map, expected a sequence").
      val ids = ArrayList<Int>()
      for (key in prefs.all.keys) {
        key.toIntOrNull()?.let { ids.add(it) }
      }
      invoke.resolveObject(ids)
    } catch (e: Exception) {
      e.printStackTrace()
      invoke.reject(e.message ?: "Не удалось прочитать хранилище уведомлений", null as String?)
    }
  }
}
