import 'package:flutter/material.dart';

import '../models/event_log.dart';
import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';

class LogsScreen extends StatelessWidget {
  const LogsScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final logs = controller.logs;
        return Scaffold(
          appBar: AppBar(title: const Text('Event Logs')),
          body: logs.isEmpty
              ? const Center(child: Text('아직 기록된 이벤트가 없습니다.'))
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: logs.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: 8),
                  itemBuilder: (context, index) => _LogTile(log: logs[index]),
                ),
        );
      },
    );
  }
}

class _LogTile extends StatelessWidget {
  const _LogTile({required this.log});

  final EventLog log;

  @override
  Widget build(BuildContext context) {
    final color = switch (log.state) {
      GaitState.normal => Colors.green,
      GaitState.warning => Colors.orange,
      GaitState.fog => Colors.red,
      GaitState.recovery => Colors.blue,
    };

    return Card(
      child: ListTile(
        leading: CircleAvatar(backgroundColor: color, radius: 8),
        title: Text(_stateLabel(log.state)),
        subtitle: Text(
          '${_contextLabel(log.context)} · risk ${log.risk.toStringAsFixed(2)}'
          ' · cue ${log.cueActive ? 'on' : 'off'}',
        ),
        trailing: Text(
          '${log.timestamp.hour.toString().padLeft(2, '0')}:${log.timestamp.minute.toString().padLeft(2, '0')}:${log.timestamp.second.toString().padLeft(2, '0')}',
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

  String _contextLabel(GaitContext context) => switch (context) {
        GaitContext.walking => 'Walking',
        GaitContext.turning => 'Turning',
        GaitContext.standing => 'Standing',
      };
}
