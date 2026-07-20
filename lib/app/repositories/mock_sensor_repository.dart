import 'dart:async';
import 'dart:math';

import '../models/sensor_frame.dart';
import 'sensor_repository.dart';

class MockSensorRepository implements SensorRepository {
  final _random = Random();
  StreamController<SensorFrame>? _controller;
  Timer? _timer;
  int _tick = 0;

  @override
  Stream<SensorFrame> watchFrames() {
    _controller ??= StreamController<SensorFrame>.broadcast(
      onListen: _start,
      onCancel: _stop,
    );
    return _controller!.stream;
  }

  void _start() {
    _timer ??= Timer.periodic(const Duration(milliseconds: 350), (_) {
      _tick++;
      final phase = _tick % 24;
      final state = switch (phase) {
        >= 0 && < 12 => GaitState.normal,
        >= 12 && < 17 => GaitState.warning,
        >= 17 && < 20 => GaitState.fog,
        _ => GaitState.recovery,
      };
      final context = phase >= 10 && phase < 19
          ? GaitContext.turning
          : GaitContext.walking;
      final risk = switch (state) {
        GaitState.normal => _range(0.15, 0.38),
        GaitState.warning => _range(0.45, 0.68),
        GaitState.fog => _range(0.75, 0.95),
        GaitState.recovery => _range(0.22, 0.40),
      };
      final cueMode = switch (state) {
        GaitState.normal => CueMode.none,
        GaitState.warning => CueMode.haptic,
        GaitState.fog when context == GaitContext.turning => CueMode.multisensory,
        GaitState.fog => CueMode.audio,
        GaitState.recovery => CueMode.haptic,
      };
      final cadence = switch (state) {
        GaitState.normal => _intRange(94, 104),
        GaitState.warning => _intRange(86, 94),
        GaitState.fog => _intRange(72, 84),
        GaitState.recovery => _intRange(88, 96),
      };
      _controller?.add(
        SensorFrame(
          timestamp: DateTime.now(),
          pressure: List.generate(8, (index) {
            final forefoot = index < 4;
            final heel = index >= 5;
            final base = switch (state) {
              GaitState.normal => forefoot ? 98 : 78,
              GaitState.warning => forefoot ? 85 : 72,
              GaitState.fog => heel ? 110 : 52,
              GaitState.recovery => forefoot ? 88 : 76,
            };
            final offset = (index % 2 == 0) ? 6 : -4;
            final amp = context == GaitContext.turning ? 28 : 18;
            return (base + offset + _random.nextDouble() * amp).toDouble();
          }),
          accel: Vector3Data(
            x: _range(-0.4, 0.6),
            y: _range(-0.2, 0.4),
            z: _range(0.8, 1.2),
          ),
          gyro: Vector3Data(
            x: _range(-15, 15),
            y: _range(-10, 10),
            z: context == GaitContext.turning ? _range(35, 80) : _range(2, 18),
          ),
          copX: _range(0.2, 0.8),
          copY: _range(0.2, 0.8),
          risk: risk,
          context: context,
          state: state,
          battery: max(15, 100 - (_tick ~/ 18)),
          cueActive: state == GaitState.warning || state == GaitState.fog,
          cueMode: cueMode,
          freezeIndex: switch (state) {
            GaitState.normal => _range(0.12, 0.24),
            GaitState.warning => _range(0.33, 0.49),
            GaitState.fog => _range(0.62, 0.89),
            GaitState.recovery => _range(0.25, 0.38),
          },
          stepVariability: switch (state) {
            GaitState.normal => _range(0.08, 0.14),
            GaitState.warning => _range(0.16, 0.25),
            GaitState.fog => _range(0.26, 0.42),
            GaitState.recovery => _range(0.12, 0.20),
          },
          asymmetry: switch (state) {
            GaitState.normal => _range(0.05, 0.11),
            GaitState.warning => _range(0.10, 0.19),
            GaitState.fog => _range(0.20, 0.31),
            GaitState.recovery => _range(0.09, 0.14),
          },
          turningRisk: context == GaitContext.turning
              ? _range(0.58, 0.88)
              : _range(0.10, 0.32),
          cadenceBpm: cadence,
        ),
      );
    });
  }

  double _range(double min, double max) => min + _random.nextDouble() * (max - min);

  int _intRange(int min, int max) => min + _random.nextInt(max - min + 1);

  void _stop() {
    if (_controller?.hasListener ?? false) return;
    _timer?.cancel();
    _timer = null;
  }

  @override
  Future<void> dispose() async {
    _timer?.cancel();
    await _controller?.close();
  }
}
