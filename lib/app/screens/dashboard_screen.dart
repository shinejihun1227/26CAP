import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/section_card.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final frame = controller.latestFrame;
        final isConnected = controller.isConnected;
        return Scaffold(
          appBar: AppBar(title: const Text('StepOn 개요')),
          body: frame == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(28),
                        gradient: const LinearGradient(
                          colors: [StepOnColors.navy, StepOnColors.blue],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        border: Border.all(
                          color: StepOnColors.sky.withOpacity(0.24),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            '낙상 전에 멈춤을 먼저 읽는 깔창',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'StepOn · FoG 전조 감지 및\n개인 맞춤 큐잉 시스템',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 26,
                              fontWeight: FontWeight.w800,
                              height: 1.3,
                            ),
                          ),
                          const SizedBox(height: 18),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _HeroChip(label: isConnected ? '연결됨' : '연결 대기'),
                              _HeroChip(label: frame.state.label),
                              _HeroChip(label: frame.context.label),
                              _HeroChip(label: '배터리 ${frame.battery}%'),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _MetricCard(
                            title: '현재 위험도',
                            value: isConnected ? '${(frame.risk * 100).round()}점' : '--',
                            subtitle: 'Pre-FoG / FoG 판단',
                            color: StepOnColors.blue,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _MetricCard(
                            title: '개인 템포',
                            value: isConnected ? '${frame.cadenceBpm} BPM' : '--',
                            subtitle: '큐잉 기준 박자',
                            color: StepOnColors.success,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: 'AI 조언',
                      subtitle: '현재는 규칙 기반 분석 카드로 시작하고, 추후 실제 AI API와 연결할 수 있습니다.',
                      child: Text(
                        controller.aiAdvice,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ),
                    const SizedBox(height: 16),
                    const SectionCard(
                      title: '앱에서 표현할 핵심 흐름',
                      subtitle: 'PDF의 Sense · Detect · Cue · Report 구조를 앱 안으로 옮겼습니다.',
                      child: Column(
                        children: [
                          _FlowTile(
                            step: 'Sense',
                            title: '양발 압력 8셀 + IMU 수집',
                            subtitle: '좌우 인솔의 압력 분포와 자세 정보를 동시에 수집합니다.',
                          ),
                          SizedBox(height: 12),
                          _FlowTile(
                            step: 'Detect',
                            title: 'Pre-FoG · Turning 위험 판단',
                            subtitle: 'Freeze Index, COP, 보폭 변동성, 비대칭, turning risk를 반영합니다.',
                          ),
                          SizedBox(height: 12),
                          _FlowTile(
                            step: 'Cue',
                            title: '햅틱 · 청각 · 시각 큐잉',
                            subtitle: '연결 상태와 위험 단계에 따라 큐잉 강도를 점진적으로 조정합니다.',
                          ),
                          SizedBox(height: 12),
                          _FlowTile(
                            step: 'History',
                            title: '일자별 히스토리 분석',
                            subtitle: 'Warning/FoG/Turning 패턴을 날짜별로 누적해 상담 보조 정보로 정리합니다.',
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
}

class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.title,
    required this.value,
    required this.subtitle,
    required this.color,
  });

  final String title;
  final String value;
  final String subtitle;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 10),
            Text(
              value,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: color,
                    fontSize: 28,
                  ),
            ),
            const SizedBox(height: 6),
            Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class _FlowTile extends StatelessWidget {
  const _FlowTile({
    required this.step,
    required this.title,
    required this.subtitle,
  });

  final String step;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: StepOnColors.blue.withOpacity(0.10),
            borderRadius: BorderRadius.circular(18),
          ),
          alignment: Alignment.center,
          child: Text(
            step,
            style: const TextStyle(
              color: StepOnColors.blue,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
      ],
    );
  }
}
