import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/event_log.dart';
import '../models/sensor_frame.dart';
import '../repositories/sensor_repository.dart';

class DailyHistorySummary {
  final String dateLabel;
  final int warningCount;
  final int fogCount;
  final int turningCount;
  final double averageRisk;

  const DailyHistorySummary({
    required this.dateLabel,
    required this.warningCount,
    required this.fogCount,
    required this.turningCount,
    required this.averageRisk,
  });
}

class SensorController extends ChangeNotifier {
  SensorController({required SensorRepository repository}) : _repository = repository;

  final SensorRepository _repository;
  StreamSubscription<SensorFrame>? _subscription;

  SensorFrame? _latestFrame;
  GaitState? _lastLoggedState;
  final List<EventLog> _logs = [];

  SensorFrame? get latestFrame => _latestFrame;
  List<EventLog> get logs => List.unmodifiable(_logs.reversed);

  bool get isConnected => _latestFrame?.isConnected ?? false;
  int get warningCount => _logs.where((e) => e.state == GaitState.warning).length;
  int get fogCount => _logs.where((e) => e.state == GaitState.fog).length;
  int get cueCount => _logs.where((e) => e.cueActive).length;
  int get turningCount => _logs.where((e) => e.context == GaitContext.turning).length;
  double get averageRisk =>
      _logs.isEmpty ? 0 : _logs.map((e) => e.risk).reduce((a, b) => a + b) / _logs.length;
  double get turningRatio => _logs.isEmpty ? 0 : turningCount / _logs.length;
  EventLog? get latestLog => logs.isEmpty ? null : logs.first;

  List<DailyHistorySummary> get dailyHistory {
    final latest = _latestFrame;
    if (latest == null || !latest.isConnected) return const [];

    final today = latest.timestamp;
    return List.generate(5, (index) {
      final day = today.subtract(Duration(days: index));
      final scale = 1 - (index * 0.12);
      final average = (averageRisk * scale).clamp(0.12, 0.92);
      return DailyHistorySummary(
        dateLabel: '${day.month}/${day.day}',
        warningCount: (warningCount * scale).round().clamp(1, 12),
        fogCount: (fogCount * scale).round().clamp(0, 8),
        turningCount: (turningCount * scale).round().clamp(1, 12),
        averageRisk: average.toDouble(),
      );
    });
  }

  String get aiAdvice {
    final frame = _latestFrame;
    if (frame == null || !frame.isConnected) {
      return '현재는 기기 연결 전 상태입니다. 연결이 되면 양발 압력 분포와 위험 문맥을 바탕으로 보행 분석 코멘트를 제공할 수 있습니다.';
    }

    if (frame.state == GaitState.fog) {
      return '현재 동결 위험이 높습니다. 특히 ${frame.context.label} 상황에서 위험도가 올라가고 있어, 보행 시작 전 햅틱과 메트로놈 큐잉을 함께 주는 방식이 적절해 보입니다.';
    }

    if (frame.context == GaitContext.turning && frame.turningRisk > 0.6) {
      return '방향 전환 시 위험도가 높게 관찰됩니다. 회전 구간에서 보폭을 조금 더 크게 유도하고, turning 구간 임계값을 보수적으로 두는 것이 좋겠습니다.';
    }

    if (frame.asymmetry > 0.18) {
      return '좌우 압력 비대칭이 커지고 있습니다. 양발 하중 분포와 COP 이동을 함께 확인하면서 기준선 보정이 필요해 보입니다.';
    }

    return '현재는 비교적 안정적인 보행입니다. 일자별 히스토리를 누적해서 위험 시간대와 큐잉 반응 패턴을 함께 보는 쪽이 좋겠습니다.';
  }

  void start() {
    _subscription ??= _repository.watchFrames().listen((frame) {
      _latestFrame = frame;

      if (!frame.isConnected) {
        notifyListeners();
        return;
      }

      final shouldLog = _lastLoggedState != frame.state;
      if (shouldLog) {
        _lastLoggedState = frame.state;
        _logs.add(
          EventLog(
            timestamp: frame.timestamp,
            state: frame.state,
            context: frame.context,
            risk: frame.risk,
            cueActive: frame.cueActive,
            cueMode: frame.cueMode,
          ),
        );
        if (_logs.length > 120) {
          _logs.removeAt(0);
        }
      }
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _repository.dispose();
    super.dispose();
  }
}
