package com.zkproject.dailyplanner

import android.app.Activity
import android.content.Context
import app.tauri.annotation.Command
import app.tauri.notification.BatchArgs
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

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
      val args = invoke.parseArgs(BatchArgs::class.java)
      val prefs = appContext.getSharedPreferences(NOTIFICATION_STORE, Context.MODE_PRIVATE)
      val editor = prefs.edit()
      var saved = 0
      for (notification in args.notifications) {
        val raw = notification.sourceJson ?: continue
        if (notification.schedule == null) continue
        editor.putString(notification.id.toString(), raw)
        saved++
      }
      editor.apply()
      // Пустая запись при непустом запросе = плагин изменил разбор аргументов
      // (sourceJson больше не заполняется): сообщаем ошибкой, чтобы не
      // деградировать молча.
      if (saved == 0 && args.notifications.isNotEmpty()) {
        invoke.reject("sourceJson пуст — разбор аргументов плагина изменился", null as String?)
        return
      }
      invoke.resolveObject(saved)
    } catch (e: Exception) {
      e.printStackTrace()
      invoke.reject(e.message ?: "Не удалось записать уведомления в хранилище", null as String?)
    }
  }
}
