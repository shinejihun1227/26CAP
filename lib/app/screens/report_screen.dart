import 'package:flutter/material.dart';

import '../services/sensor_controller.dart';
import '../widgets/info_card.dart';

class ReportScreen extends StatelessWidget {
  const ReportScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final total = controller.logs.length;
        final warning = controller.warningCount;
        final fog = controller.fogCount;
        final cue = controller.cueCount;
        return Scaffold(
          appBar: AppBar(title: const Text('Daily Report')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: InfoCard(
                      title: 'Total Events',
                      value: '$total',
                      subtitle: 'state transitions',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InfoCard(
                      title: 'Cue Count',
                      value: '$cue',
                      subtitle: 'warning + fog',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: InfoCard(
                      title: 'Warning',
                      value: '$warning',
                      subtitle: 'pre-fog candidates',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: InfoCard(
                      title: 'FoG',
                      value: '$fog',
                      subtitle: 'high-risk segments',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text('Prototype insight'),
                      SizedBox(height: 8),
                      Text(
                        '현재 리포트는 mock 데이터 기반입니다. 실제 BLE 연동 후에는 시간대별 위험 빈도, turning 비율, 평균 회복시간, CSV 내보내기를 추가하면 됩니다.',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

