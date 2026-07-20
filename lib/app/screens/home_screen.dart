import 'package:flutter/material.dart';

import '../services/sensor_controller.dart';
import 'cueing_screen.dart';
import 'dashboard_screen.dart';
import 'live_monitor_screen.dart';
import 'report_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final screens = [
      DashboardScreen(controller: widget.controller),
      LiveMonitorScreen(controller: widget.controller),
      CueingScreen(controller: widget.controller),
      ReportScreen(controller: widget.controller),
      const SettingsScreen(),
    ];

    return Scaffold(
      body: SafeArea(child: screens[_currentIndex]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (value) => setState(() => _currentIndex = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.space_dashboard_outlined), label: '개요'),
          NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), label: '센서'),
          NavigationDestination(icon: Icon(Icons.vibration_outlined), label: '큐잉'),
          NavigationDestination(icon: Icon(Icons.assessment_outlined), label: '히스토리'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), label: '기기'),
        ],
      ),
    );
  }
}
