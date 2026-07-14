/// Цветовая палитра ежедневника в стиле tweek.so.
/// Бумажный бежевый фон, тёплые акценты.
library;

import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  /// Фон-бумага.
  static const paper = Color(0xFFFAF7F0);
  static const card = Color(0xFFFFFFFF);
  static const cardBorder = Color(0xFFE8E2D4);
  static const muted = Color(0xFF9A8F7A);
  static const text = Color(0xFF5A5240);
  static const doneOverlay = Color(0xFFF0ECE2);

  /// Акцент — терракотовый.
  static const accent = Color(0xFFC9A87C);

  /// Сеты по умолчанию (ARGB).
  static const setNone = Color(0xFFF0ECE2);
  static const setWork = Color(0xFFC9A87C);
  static const setPersonal = Color(0xFF7EB8C4);
  static const setSport = Color(0xFFE8A87C);

  /// Карта id сета -> цвет для UI (быстрый lookup).
  static const setColors = <String, Color>{
    'cs-none': setNone,
    'cs-work': setWork,
    'cs-personal': setPersonal,
    'cs-sport': setSport,
  };

  /// Цвет сета по id (fallback на setNone).
  static Color colorForSet(String? colorSetId) =>
      setColors[colorSetId] ?? setNone;
}
