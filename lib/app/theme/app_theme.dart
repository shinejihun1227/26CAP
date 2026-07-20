import 'package:flutter/material.dart';

class StepOnColors {
  static const navy = Color(0xFF0E1A2B);
  static const blue = Color(0xFF2F6BFF);
  static const sky = Color(0xFF75A8FF);
  static const ice = Color(0xFFF4F7FC);
  static const surface = Color(0xFFFFFFFF);
  static const success = Color(0xFF1FA971);
  static const warning = Color(0xFFF6A623);
  static const danger = Color(0xFFE84C5A);
  static const border = Color(0xFFD8E1F0);
  static const textSubtle = Color(0xFF65738B);
}

ThemeData buildStepOnTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: StepOnColors.blue,
    brightness: Brightness.light,
  ).copyWith(
    primary: StepOnColors.blue,
    secondary: StepOnColors.sky,
    surface: StepOnColors.surface,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: StepOnColors.ice,
    appBarTheme: const AppBarTheme(
      backgroundColor: StepOnColors.ice,
      foregroundColor: StepOnColors.navy,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: StepOnColors.navy,
      ),
    ),
    cardTheme: CardTheme(
      color: StepOnColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: const BorderSide(color: StepOnColors.border),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: StepOnColors.blue.withValues(alpha: 0.12),
      side: const BorderSide(color: StepOnColors.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      labelStyle: const TextStyle(
        color: StepOnColors.navy,
        fontWeight: FontWeight.w600,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: StepOnColors.blue.withValues(alpha: 0.14),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          color: states.contains(WidgetState.selected)
              ? StepOnColors.blue
              : StepOnColors.textSubtle,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
        ),
      ),
    ),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        color: StepOnColors.navy,
        fontWeight: FontWeight.w800,
      ),
      titleLarge: TextStyle(
        color: StepOnColors.navy,
        fontWeight: FontWeight.w700,
      ),
      titleMedium: TextStyle(
        color: StepOnColors.navy,
        fontWeight: FontWeight.w700,
      ),
      bodyLarge: TextStyle(
        color: StepOnColors.navy,
        height: 1.45,
      ),
      bodyMedium: TextStyle(
        color: StepOnColors.textSubtle,
        height: 1.45,
      ),
    ),
  );
}
