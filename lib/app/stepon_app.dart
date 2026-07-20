import 'package:flutter/material.dart';

import 'repositories/mock_sensor_repository.dart';
import 'screens/home_screen.dart';
import 'services/sensor_controller.dart';
import 'theme/app_theme.dart';

class StepOnApp extends StatefulWidget {
  const StepOnApp({super.key});

  @override
  State<StepOnApp> createState() => _StepOnAppState();
}

class _StepOnAppState extends State<StepOnApp> {
  late final SensorController controller;

  @override
  void initState() {
    super.initState();
    controller = SensorController(repository: MockSensorRepository())..start();
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'StepOn',
      theme: buildStepOnTheme(),
      home: HomeScreen(controller: controller),
    );
  }
}
