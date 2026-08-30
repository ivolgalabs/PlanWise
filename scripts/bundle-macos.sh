#!/bin/bash
# Полная сборка macOS: cargo tauri build + встраивание WidgetKit-расширения
# в Contents/PlugIns + переподпись + регистрация в pluginkit.
# Использование: bash scripts/bundle-macos.sh  (или npm run build:macos)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/src-tauri"
# Общий target каталог (единая папка сборки для всех проектов машины) —
# берём из CARGO_TARGET_DIR или значения по умолчанию (см. ~/.cargo/config.toml).
TARGET_DIR="${CARGO_TARGET_DIR:-/Volumes/Kingston/My_projects/.cache/target}"
# Имя .app — productName из tauri.conf.json (сейчас «PlanWise»).
APP_BUNDLE="$TARGET_DIR/release/bundle/macos/PlanWise.app"
APPEX_SRC="$TAURI/build/widgets/ЕжедневникWidgets.appex"
APPEX_DST="$APP_BUNDLE/Contents/PlugIns/ЕжедневникWidgets.appex"

echo "[bundle-macos] cargo tauri build..."
cd "$TAURI"
cargo tauri build

echo "[bundle-macos] сборка виджета..."
bash "$TAURI/widgets/build.sh"

echo "[bundle-macos] встраивание .appex в PlugIns..."
mkdir -p "$APP_BUNDLE/Contents/PlugIns"
rm -rf "$APPEX_DST"
cp -R "$APPEX_SRC" "$APPEX_DST"

echo "[bundle-macos] переподпись .app (ad-hoc + entitlements)..."
# ВАЖНО: без --deep! --deep перезаписывал бы entitlements уже подписанного
# .appex (затирал app-sandbox виджета своими). .appex подписан в build.sh,
# а здесь подписывается только сам .app — codesign сам запечатает nested .appex.
codesign --force --sign - --entitlements "$TAURI/entitlements.plist" "$APP_BUNDLE"

echo "[bundle-macos] регистрация расширения в pluginkit..."
pluginkit -a "$APPEX_DST" 2>/dev/null || true
pluginkit -m -A -D 2>/dev/null | grep -i dailyplanner || true

echo "[bundle-macos] готово: $APP_BUNDLE"
