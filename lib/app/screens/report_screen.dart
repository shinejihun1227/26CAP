import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/section_card.dart';

class ReportScreen extends StatelessWidget {
  const ReportScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final latest = controller.latestFrame;
        return Scaffold(
          appBar: AppBar(title: const Text('리포트')),
          body: latest == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _ReportMetric(
                            title: '총 이벤트',
                            value: '${controller.logs.length}',
                            subtitle: '상태 전이 기준',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _ReportMetric(
                            title: '평균 위험도',
                            value: '${(controller.averageRisk * 100).round()}점',
                            subtitle: '누적 평균',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _ReportMetric(
                            title: '전조 경고',
                            value: '${controller.warningCount}',
                            subtitle: 'Pre-FoG 후보',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _ReportMetric(
                            title: '회전 비율',
                            value: '${(controller.turningRatio * 100).round()}%',
                            subtitle: 'Turning-aware',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '상담 보조 인사이트',
                      subtitle: '투약 지시가 아니라, 일상 보행 패턴을 요약한 참고 정보입니다.',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '최근 기록 기준으로 ${controller.turningCount}회가 방향 전환 문맥에서 발생했습니다. '
                            '방향 전환 시 Warning 임계값을 더 보수적으로 볼 필요가 있습니다.',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            '현재 개인 템포는 ${latest.cadenceBpm} BPM이며, ${latest.cueMode.label} 큐잉이 우선 활성화되고 있습니다.',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '이벤트 타임라인',
                      subtitle: '상태 변화가 일어날 때만 기록합니다.',
                      child: controller.logs.isEmpty
                          ? const Text('아직 기록된 이벤트가 없습니다.')
                          : Column(
                              children: controller.logs.take(12).map((log) {
                                final color = _stateColor(log.state);
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 12),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        width: 12,
                                        height: 12,
                                        margin: const EdgeInsets.only(top: 6),
                                        decoration: BoxDecoration(
                                          color: color,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              '${log.state.label} · ${log.context.label}',
                                              style: Theme.of(context).textTheme.titleMedium,
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              '위험도 ${log.risk.toStringAsFixed(2)} · '
                                              '${log.cueMode.label} ${log.cueActive ? '활성' : '대기'}',
                                              style: Theme.of(context).textTheme.bodyMedium,
                                            ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        '${log.timestamp.hour.toString().padLeft(2, '0')}:${log.timestamp.minute.toString().padLeft(2, '0')}:${log.timestamp.second.toString().padLeft(2, '0')}',
                                        style: Theme.of(context).textTheme.bodyMedium,
                                      ),
                                    ],
                                  ),
                                );
                              }).toList(),
                            ),
                    ),
                  ],
                ),
        );
      },
    );
  }

  Color _stateColor(GaitState state) => switch (state) {
        GaitState.normal => StepOnColors.success,
        GaitState.warning => StepOnColors.warning,
        GaitState.fog => StepOnColors.danger,
        GaitState.recovery => StepOnColors.blue,
      };
}

class _ReportMetric extends StatelessWidget {
  const _ReportMetric({
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
            Text(
              value,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontSize: 28),
            ),
            const SizedBox(height: 4),
            Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}
