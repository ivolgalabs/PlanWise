package com.zkproject.dailyplanner

import android.app.Activity
import android.content.Context
import app.tauri.annotation.Command
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

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
}
