# Классы виджетов и быстрого ввода: рефлексия и JNI обращаются к ним по имени.
# - WidgetPushPlugin инстанцирует JNI (register_android_plugin в lib.rs) —
#   обфускация имени сломала бы регистрацию плагина в release-сборке.
# - AppWidgetProvider'ы создаёт система по имени класса из манифеста.
# - QuickAddActivity запускается PendingIntent'ом по классу из манифеста.
-keep class com.zkproject.dailyplanner.WidgetPushPlugin { *; }
-keep class com.zkproject.dailyplanner.WidgetProvider { *; }
-keep class com.zkproject.dailyplanner.DayWidgetProvider { *; }
-keep class com.zkproject.dailyplanner.WeekWidgetProvider { *; }
-keep class com.zkproject.dailyplanner.SomedayWidgetProvider { *; }
-keep class com.zkproject.dailyplanner.NextWidgetProvider { *; }
-keep class com.zkproject.dailyplanner.CounterWidgetProvider { *; }
-keep class com.zkproject.dailyplanner.WidgetActionReceiver { *; }
-keep class com.zkproject.dailyplanner.QuickAddActivity { *; }
