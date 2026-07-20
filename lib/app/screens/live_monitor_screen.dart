import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';
import '../widgets/info_card.dart';
import '../widgets/pressure_grid.dart';
import '../widgets/risk_gauge.dart';

class LiveMonitorScreen extends StatelessWidget {
  const LiveMonitorScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final frame = controller.latestFrame;
        return Scaffold(
          appBar: AppBar(
            title: const Text('StepOn Live Monitor'),
            actions: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Chip(
                  avatar: const Icon(Icons.bluetooth_connected, size: 18),
                  label: Text(frame == null ? 'Mock idle' : 'Mock connected'),
                ),
              ),
            ],
          ),
          body: frame == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    RiskGauge(frame: frame),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: InfoCard(
                            title: 'Battery',
                            value: '${frame.battery}%',
                            subtitle: 'device status',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: InfoCard(
                            title: 'Context',
                            value: _contextLabel(frame.context),
                            subtitle: frame.cueActive ? 'cue active' : 'cue idle',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text('Pressure 8-cell', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    PressureGrid(values: frame.pressure),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: InfoCard(
                            title: 'Accel',
                            value: _vector(frame.accel),
                            subtitle: 'g',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: InfoCard(
                            title: 'Gyro',
                            value: _vector(frame.gyro),
                            subtitle: 'deg/s',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    InfoCard(
                      title: 'Center of Pressure',
                      value: 'x ${frame.copX.toStringAsFixed(2)} / y ${frame.copY.toStringAsFixed(2)}',
                      subtitle: 'normalized position',
                    ),
                  ],
                ),
        );
      },
    );
  }

  String _contextLabel(GaitContext context) => switch (context) {
        GaitContext.walking => 'Walking',
        GaitContext.turning => 'Turning',
        GaitContext.standing => 'Standing',
      };

  String _vector(Vector3Data vector) =>
      '${vector.x.toStringAsFixed(2)}, ${vector.y.toStringAsFixed(2)}, ${vector.z.toStringAsFixed(2)}';
}

