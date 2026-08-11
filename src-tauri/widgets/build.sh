#!/bin/bash
# Сборка WidgetKit-расширения без Xcode: swiftc из Command Line Tools +
# codesign ad-hoc. Результат — ЕжедневникWidgets.appex в каталоге рядом
# со скриптом (../build/widgets/).
set -euo pipefail

cd "$(dirname "$0")"
OUT="${WIDGET_OUT:-$(cd ../build/widgets && pwd)}"
NAME="ЕжедневникWidgets"
APPEX="$OUT/$NAME.appex"
SDK="$(xcrun --sdk macosx --show-sdk-path)"

rm -rf "$OUT"
mkdir -p "$OUT/$NAME.appex/Contents/MacOS" "$OUT/$NAME.appex/Contents/Resources"

echo "[widgets] swiftc: компиляция виджетов..."
# -parse-as-library: @main в WidgetBundle; target — arm64 macOS 14+ (виджеты
# на рабочем столе появились в Sonoma); фреймворки линкуются из системного SDK.
swiftc \
  -parse-as-library \
  -target arm64-apple-macos14.0 \
  -sdk "$SDK" \
  -framework WidgetKit \
  -framework SwiftUI \
  -framework AppKit \
  -O \
  WidgetBundle.swift DataStore.swift TimelineProvider.swift WidgetViews.swift \
  -o "$APPEX/Contents/MacOS/Widgets"

echo "[widgets] Info.plist..."
cp Info.plist "$APPEX/Contents/Info.plist"
plutil -replace CFBundleExecutable -string Widgets "$APPEX/Contents/Info.plist" 2>/dev/null || true

echo "[widgets] codesign (ad-hoc + entitlements)..."
# Entitlements: песочница + App Group — без них система не регистрирует
# WidgetKit-расширение (флаг launch-disabled).
codesign --force --sign - --entitlements entitlements.plist "$APPEX"

echo "[widgets] готово: $APPEX"
