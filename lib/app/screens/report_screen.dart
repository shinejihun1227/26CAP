import 'package:flutter/material.dart';

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
        return Scaffold(
          appBar: AppBar(title: const Text('히스토리 분석')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              SectionCard(
                title: '일자별 히스토리',
                subtitle: '환자의 날마다 Warning / FoG / Turning 패턴을 비교합니다.',
                child: controller.dailyHistory.isEmpty
                    ? const Text('아직 연결 데이터가 없어 히스토리를 생성하지 않았습니다.')
                    : Column(
                        children: controller.dailyHistory.map((day) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                color: StepOnColors.ice,
                                border: Border.all(color: StepOnColors.border),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(day.dateLabel, style: Theme.of(context).textTheme.titleMedium),
                                  const SizedBox(height: 10),
                                  Row(
                                    children: [
                                      Expanded(child: _DayMetric(label: '전조', value: '${day.warningCount}')),
                                      Expanded(child: _DayMetric(label: '동결', value: '${day.fogCount}')),
                                      Expanded(child: _DayMetric(label: '회전', value: '${day.turningCount}')),
                                      Expanded(
                                        child: _DayMetric(
                                          label: '평균 위험',
                                          value: '${(day.averageRisk * 100).round()}점',
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      ),
              ),
              const SizedBox(height: 16),
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
                title: 'AI 분석 조언',
                subtitle: '현재는 규칙 기반 설명형 조언이며, 추후 LLM 기반 요약으로 확장 가능합니다.',
                child: Text(
                  controller.aiAdvice,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
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

class _DayMetric extends StatelessWidget {
  const _DayMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 4),
        Text(value, style: Theme.of(context).textTheme.titleMedium),
      ],
    );
  }
}
