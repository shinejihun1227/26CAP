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
    _timer ??= Timer.periodic(const Duration(milliseconds: 500), (_) {
      _tick++;
      final isConnected = _tick > 4;
      final phase = _tick % 28;

      if (!isConnected) {
        _controller?.add(
          SensorFrame(
            timestamp: DateTime.now(),
            isConnected: false,
            leftPressure: List.filled(8, 0),
            rightPressure: List.filled(8, 0),
            accel: const Vector3Data(x: 0, y: 0, z: 0),
            gyro: const Vector3Data(x: 0, y: 0, z: 0),
            copX: 0,
            copY: 0,
            risk: 0,
            context: GaitContext.standing,
            state: GaitState.normal,
            battery: 0,
            cueActive: false,
            cueMode: CueMode.none,
            freezeIndex: 0,
            stepVariability: 0,
            asymmetry: 0,
            turningRisk: 0,
            cadenceBpm: 0,
          ),
        );
        return;
      }

      final state = switch (phase) {
        >= 0 && < 12 => GaitState.normal,
        >= 12 && < 18 => GaitState.warning,
        >= 18 && < 22 => GaitState.fog,
        _ => GaitState.recovery,
      };
      final context =
          phase >= 10 && phase < 22 ? GaitContext.turning : GaitContext.walking;
      final risk = switch (state) {
        GaitState.normal => _range(0.18, 0.35),
        GaitState.warning => _range(0.46, 0.67),
        GaitState.fog => _range(0.74, 0.93),
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
        GaitState.fog => _intRange(74, 84),
        GaitState.recovery => _intRange(88, 97),
      };

      _controller?.add(
        SensorFrame(
          timestamp: DateTime.now(),
          isConnected: true,
          leftPressure: _buildFootValues(
            state: state,
            context: context,
            isLeft: true,
          ),
          rightPressure: _buildFootValues(
            state: state,
            context: context,
            isLeft: false,
          ),
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
          battery: max(18, 100 - (_tick ~/ 12)),
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
          turningRisk:
              context == GaitContext.turning ? _range(0.58, 0.88) : _range(0.10, 0.32),
          cadenceBpm: cadence,
        ),
      );
    });
  }

  List<double> _buildFootValues({
    required GaitState state,
    required GaitContext context,
    required bool isLeft,
  }) {
    return List.generate(8, (index) {
      final forefoot = index < 4;
      final heel = index >= 5;
      final base = switch (state) {
        GaitState.normal => forefoot ? 96 : 76,
        GaitState.warning => forefoot ? 84 : 70,
        GaitState.fog => heel ? 108 : 50,
        GaitState.recovery => forefoot ? 88 : 74,
      };
      final lateralBias = isLeft ? -4 : 4;
      final cellOffset = (index.isEven ? 6 : -5) + lateralBias;
      final amplitude = context == GaitContext.turning ? 26 : 16;
      return (base + cellOffset + _random.nextDouble() * amplitude).toDouble();
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
