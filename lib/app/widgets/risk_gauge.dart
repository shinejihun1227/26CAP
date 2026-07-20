import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';

class RiskGauge extends StatelessWidget {
  const RiskGauge({super.key, required this.frame});

  final SensorFrame frame;

  @override
  Widget build(BuildContext context) {
    final color = switch (frame.state) {
      GaitState.normal => Colors.green,
      GaitState.warning => Colors.orange,
      GaitState.fog => Colors.red,
      GaitState.recovery => Colors.blue,
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Risk Score'),
                Chip(
                  label: Text(_stateLabel(frame.state)),
                  backgroundColor: color.withValues(alpha: 0.12),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              frame.risk.toStringAsFixed(2),
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            LinearProgressIndicator(
              value: frame.risk.clamp(0.0, 1.0),
              minHeight: 14,
              borderRadius: BorderRadius.circular(999),
              color: color,
            ),
            const SizedBox(height: 8),
            Text(
              frame.cueActive ? 'Cueing active' : 'Cueing idle',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  String _stateLabel(GaitState state) => switch (state) {
        GaitState.normal => 'Normal',
        GaitState.warning => 'Warning',
        GaitState.fog => 'FoG',
        GaitState.recovery => 'Recovery',
      };
}
