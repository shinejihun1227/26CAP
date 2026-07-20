import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/event_log.dart';
import '../models/sensor_frame.dart';
import '../repositories/sensor_repository.dart';

class SensorController extends ChangeNotifier {
  SensorController({required SensorRepository repository}) : _repository = repository;

  final SensorRepository _repository;
  StreamSubscription<SensorFrame>? _subscription;

  SensorFrame? _latestFrame;
  GaitState? _lastLoggedState;
  final List<EventLog> _logs = [];

  SensorFrame? get latestFrame => _latestFrame;
  List<EventLog> get logs => List.unmodifiable(_logs.reversed);

  int get warningCount => _logs.where((e) => e.state == GaitState.warning).length;
  int get fogCount => _logs.where((e) => e.state == GaitState.fog).length;
  int get cueCount => _logs.where((e) => e.cueActive).length;
  int get turningCount => _logs.where((e) => e.context == GaitContext.turning).length;
  double get averageRisk =>
      _logs.isEmpty ? 0 : _logs.map((e) => e.risk).reduce((a, b) => a + b) / _logs.length;
  double get turningRatio =>
      _logs.isEmpty ? 0 : turningCount / _logs.length;
  EventLog? get latestLog => logs.isEmpty ? null : logs.first;

  void start() {
    _subscription ??= _repository.watchFrames().listen((frame) {
      _latestFrame = frame;
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
