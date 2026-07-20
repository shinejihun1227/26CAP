import 'package:flutter/material.dart';

import '../models/sensor_frame.dart';
import '../services/sensor_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/section_card.dart';

class CueingScreen extends StatelessWidget {
  const CueingScreen({super.key, required this.controller});

  final SensorController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final frame = controller.latestFrame;
        final isConnected = controller.isConnected;
        return Scaffold(
          appBar: AppBar(title: const Text('큐잉 제어')),
          body: frame == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    SectionCard(
                      title: '현재 큐잉 상태',
                      subtitle: '위험도와 지속 시간에 따라 자극을 단계적으로 강화합니다.',
                      trailing: Chip(label: Text(isConnected ? frame.cueMode.label : '대기')),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            isConnected
                                ? (frame.cueActive ? '현재 큐잉이 개입 중입니다.' : '현재는 관찰 상태입니다.')
                                : '연결되면 큐잉 상태를 자동으로 전환합니다.',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 10),
                          Text(
                            isConnected
                                ? '개인 기준 박자 ${frame.cadenceBpm} BPM, 현재 상태는 ${frame.state.label}입니다.'
                                : '아직 기기가 연결되지 않았습니다.',
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                          const SizedBox(height: 16),
                          LinearProgressIndicator(
                            value: isConnected ? frame.risk.clamp(0.0, 1.0) : 0,
                            minHeight: 12,
                            borderRadius: BorderRadius.circular(999),
                            color: _stateColor(frame.state, isConnected),
                            backgroundColor: StepOnColors.border,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '큐잉 채널',
                      child: Column(
                        children: [
                          _CueTile(
                            icon: Icons.vibration,
                            title: '햅틱 큐잉',
                            subtitle: '발바닥 진동으로 다음 보행 타이밍을 유도합니다.',
                            active: isConnected &&
                                (frame.cueMode == CueMode.haptic ||
                                    frame.cueMode == CueMode.multisensory),
                          ),
                          const SizedBox(height: 12),
                          _CueTile(
                            icon: Icons.graphic_eq,
                            title: '청각 큐잉',
                            subtitle: '메트로놈 박자로 보행 리듬의 기준을 제공합니다.',
                            active: isConnected &&
                                (frame.cueMode == CueMode.audio ||
                                    frame.cueMode == CueMode.multisensory),
                          ),
                          const SizedBox(height: 12),
                          _CueTile(
                            icon: Icons.timeline,
                            title: '시각 큐잉',
                            subtitle: '레이저 기준선으로 다음 보폭을 유도합니다.',
                            active: isConnected &&
                                (frame.cueMode == CueMode.laser ||
                                    frame.cueMode == CueMode.multisensory),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionCard(
                      title: '개인화 파라미터',
                      child: Column(
                        children: [
                          _ParameterRow(label: '개인 템포', value: isConnected ? '${frame.cadenceBpm} BPM' : '--'),
                          _ParameterRow(
                            label: 'Freeze Index',
                            value: isConnected ? frame.freezeIndex.toStringAsFixed(2) : '--',
                          ),
                          _ParameterRow(
                            label: 'Turning Risk',
                            value: isConnected ? frame.turningRisk.toStringAsFixed(2) : '--',
                          ),
                          _ParameterRow(
                            label: '보폭 변동성',
                            value: isConnected ? frame.stepVariability.toStringAsFixed(2) : '--',
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

class _CueTile extends StatelessWidget {
  const _CueTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.active,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: active ? StepOnColors.blue.withOpacity(0.08) : Colors.white,
        border: Border.all(
          color: active ? StepOnColors.blue : StepOnColors.border,
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor:
                active ? StepOnColors.blue.withOpacity(0.14) : StepOnColors.ice,
            child: Icon(
              icon,
              color: active ? StepOnColors.blue : StepOnColors.textSubtle,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
          Chip(label: Text(active ? '활성' : '대기')),
        ],
      ),
    );
  }
}

class _ParameterRow extends StatelessWidget {
  const _ParameterRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyLarge)),
          Text(value, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }
}
