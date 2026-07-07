import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: DailyPlannerApp()));
}

class DailyPlannerApp extends StatelessWidget {
  const DailyPlannerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ежедневник',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFC9A87C)),
        scaffoldBackgroundColor: const Color(0xFFFAF7F0),
      ),
      home: const Scaffold(
        body: Center(child: Text('Ежедневник — Фаза 1 (фундамент готов)')),
      ),
    );
  }
}
