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
      _controller?.add(
        SensorFrame(
          timestamp: DateTime.now(),
          pressure: List.generate(8, (index) {
            final base = 60 + (index * 10);
            final amp = state == GaitState.fog ? 12 : 35;
            return (base + _random.nextDouble() * amp).toDouble();
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
        ),
      );
    });
  }

  double _range(double min, double max) => min + _random.nextDouble() * (max - min);

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

