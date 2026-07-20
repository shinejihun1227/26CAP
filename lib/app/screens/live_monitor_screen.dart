import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/foot_pressure_map.dart';
import '../widgets/section_card.dart';

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
            title: const Text('센서 모니터'),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Center(
                  child: Chip(
                    avatar: const Icon(Icons.bluetooth_connected, size: 18),
                    label: Text(frame == null ? '연결 대기' : '실시간 연결'),
                  ),
                ),
              ),
            ],
          ),
          body: frame == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    SectionCard(
                      title: '실시간 위험 상태',
                      subtitle: 'Pre-FoG와 turning-aware 위험을 함께 보여줍니다.',
                      trailing: Chip(label: Text(frame.state.label)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${(frame.risk * 100).round()}점',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  fontSize: 34,
                                  color: _stateColor(frame.state),
                                ),
                          ),
                          const SizedBox(height: 12),
                          LinearProgressIndicator(
                            value: frame.risk.clamp(0.0, 1.0),
                            minHeight: 14,
                            borderRadius: BorderRadius.circular(999),
                            color: _stateColor(frame.state),
                            backgroundColor: StepOnColors.border,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '현재 문맥: ${frame.context.label} · 큐잉 ${frame.cueActive ? '활성' : '대기'}',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '발바닥 압력 8센서',
                      subtitle: '발모양 위에 센서 위치를 배치하고, 밟을수록 값이 커지도록 표현했습니다.',
                      child: Column(
                        children: [
                          FootPressureMap(values: frame.pressure),
                          const SizedBox(height: 16),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: List.generate(
                              frame.pressure.length,
                              (index) => Chip(
                                label: Text(
                                  'P${index + 1} ${frame.pressure[index].toStringAsFixed(0)}',
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _FeatureCard(
                            title: 'Freeze Index',
                            value: frame.freezeIndex.toStringAsFixed(2),
                            subtitle: '발 떨림 기반 지표',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _FeatureCard(
                            title: 'Turning Risk',
                            value: frame.turningRisk.toStringAsFixed(2),
                            subtitle: '회전 고위험 문맥',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _FeatureCard(
                            title: '보폭 변동성',
                            value: frame.stepVariability.toStringAsFixed(2),
                            subtitle: 'Step CV 추정',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _FeatureCard(
                            title: '좌우 비대칭',
                            value: frame.asymmetry.toStringAsFixed(2),
                            subtitle: 'Asymmetry 추정',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: 'IMU 요약',
                      child: Column(
                        children: [
                          _SensorRow(label: '가속도', value: _vector(frame.accel), unit: 'g'),
                          _SensorRow(label: '자이로', value: _vector(frame.gyro), unit: 'deg/s'),
                          _SensorRow(
                            label: 'COP',
                            value:
                                'x ${frame.copX.toStringAsFixed(2)} / y ${frame.copY.toStringAsFixed(2)}',
                            unit: '정규화',
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
        );
      },
    );
  }

  String _vector(Vector3Data vector) =>
      '${vector.x.toStringAsFixed(2)}, ${vector.y.toStringAsFixed(2)}, ${vector.z.toStringAsFixed(2)}';

  Color _stateColor(GaitState state) => switch (state) {
        GaitState.normal => StepOnColors.success,
        GaitState.warning => StepOnColors.warning,
        GaitState.fog => StepOnColors.danger,
        GaitState.recovery => StepOnColors.blue,
      };
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({
    required this.title,
    required this.value,
    required this.subtitle,
  });

  final String title;
  final String value;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 10),
            Text(value, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class _SensorRow extends StatelessWidget {
  const _SensorRow({
    required this.label,
    required this.value,
    required this.unit,
  });

  final String label;
  final String value;
  final String unit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 76,
            child: Text(label, style: Theme.of(context).textTheme.bodyLarge),
          ),
          Expanded(child: Text(value, style: Theme.of(context).textTheme.titleMedium)),
          Text(unit, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}
