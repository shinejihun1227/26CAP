import 'package:flutter/material.dart';

import '../services/sensor_controller.dart';
import 'live_monitor_screen.dart';
import 'logs_screen.dart';
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
      LiveMonitorScreen(controller: widget.controller),
      LogsScreen(controller: widget.controller),
      ReportScreen(controller: widget.controller),
      const SettingsScreen(),
    ];

    return Scaffold(
      body: SafeArea(child: screens[_currentIndex]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (value) => setState(() => _currentIndex = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), label: 'Live'),
          NavigationDestination(icon: Icon(Icons.list_alt_outlined), label: 'Logs'),
          NavigationDestination(icon: Icon(Icons.assessment_outlined), label: 'Report'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), label: 'Setup'),
        ],
      ),
    );
  }
}

