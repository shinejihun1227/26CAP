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
        final isConnected = controller.isConnected;
        return Scaffold(
          appBar: AppBar(
            title: const Text('센서 모니터'),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16),
                child: Center(
                  child: Chip(
                    avatar: Icon(
                      isConnected ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
                      size: 18,
                    ),
                    label: Text(isConnected ? '실시간 연결' : '연결 대기'),
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
                      title: '연결 상태',
                      subtitle: isConnected
                          ? '양발 인솔과 통신 중입니다. 센서 값 수신 상태로 전환되었습니다.'
                          : '아직 인솔과 통신되지 않았습니다. 연결되면 센서 노드가 켜지고 압력 값을 받기 시작합니다.',
                      trailing: Chip(label: Text(isConnected ? 'ON' : 'OFF')),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          color: isConnected
                              ? StepOnColors.blue.withOpacity(0.08)
                              : StepOnColors.border.withOpacity(0.25),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              isConnected ? Icons.sensors : Icons.sensors_off,
                              color: isConnected ? StepOnColors.blue : StepOnColors.textSubtle,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                isConnected
                                    ? '센서 수신 가능 상태입니다.'
                                    : '현재는 센서 수신 대기 상태입니다.',
                                style: Theme.of(context).textTheme.bodyLarge,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '실시간 위험 상태',
                      subtitle: 'Pre-FoG와 turning-aware 위험을 함께 보여줍니다.',
                      trailing: Chip(label: Text(frame.state.label)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            isConnected ? '${(frame.risk * 100).round()}점' : '--',
                            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  fontSize: 34,
                                  color: _stateColor(frame.state, isConnected),
                                ),
                          ),
                          const SizedBox(height: 12),
                          LinearProgressIndicator(
                            value: isConnected ? frame.risk.clamp(0.0, 1.0) : 0,
                            minHeight: 14,
                            borderRadius: BorderRadius.circular(999),
                            color: _stateColor(frame.state, isConnected),
                            backgroundColor: StepOnColors.border,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            isConnected
                                ? '현재 문맥: ${frame.context.label} · 큐잉 ${frame.cueActive ? '활성' : '대기'}'
                                : '연결이 되면 현재 문맥과 큐잉 상태를 표시합니다.',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '양발 압력 센서',
                      subtitle: '좌우 인솔의 8개 압력 센서를 각각 표시합니다.',
                      child: Column(
                        children: [
                          BilateralPressureView(
                            leftValues: frame.leftPressure,
                            rightValues: frame.rightPressure,
                            isConnected: isConnected,
                          ),
                          const SizedBox(height: 16),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              ...List.generate(
                                frame.leftPressure.length,
                                (index) => Chip(
                                  label: Text(
                                    'L${index + 1} ${isConnected ? frame.leftPressure[index].toStringAsFixed(0) : 'OFF'}',
                                  ),
                                ),
                              ),
                              ...List.generate(
                                frame.rightPressure.length,
                                (index) => Chip(
                                  label: Text(
                                    'R${index + 1} ${isConnected ? frame.rightPressure[index].toStringAsFixed(0) : 'OFF'}',
                                  ),
                                ),
                              ),
                            ],
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
                            value: isConnected ? frame.freezeIndex.toStringAsFixed(2) : '--',
                            subtitle: '발 떨림 기반 지표',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _FeatureCard(
                            title: 'Turning Risk',
                            value: isConnected ? frame.turningRisk.toStringAsFixed(2) : '--',
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
                            value: isConnected ? frame.stepVariability.toStringAsFixed(2) : '--',
                            subtitle: 'Step CV 추정',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _FeatureCard(
                            title: '좌우 비대칭',
                            value: isConnected ? frame.asymmetry.toStringAsFixed(2) : '--',
                            subtitle: 'Asymmetry 추정',
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
        );
      },
    );
  }

  Color _stateColor(GaitState state, bool isConnected) {
    if (!isConnected) return StepOnColors.textSubtle;
    return switch (state) {
      GaitState.normal => StepOnColors.success,
      GaitState.warning => StepOnColors.warning,
      GaitState.fog => StepOnColors.danger,
      GaitState.recovery => StepOnColors.blue,
    };
  }
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
