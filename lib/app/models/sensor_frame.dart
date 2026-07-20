enum GaitState { normal, warning, fog, recovery }

enum GaitContext { walking, turning, standing }

enum CueMode { none, haptic, audio, laser, multisensory }

class Vector3Data {
  final double x;
  final double y;
  final double z;

  const Vector3Data({
    required this.x,
    required this.y,
    required this.z,
  });
}

class SensorFrame {
  final DateTime timestamp;
  final bool isConnected;
  final List<double> leftPressure;
  final List<double> rightPressure;
  final Vector3Data accel;
  final Vector3Data gyro;
  final double copX;
  final double copY;
  final double risk;
  final GaitContext context;
  final GaitState state;
  final int battery;
  final bool cueActive;
  final CueMode cueMode;
  final double freezeIndex;
  final double stepVariability;
  final double asymmetry;
  final double turningRisk;
  final int cadenceBpm;

  const SensorFrame({
    required this.timestamp,
    required this.isConnected,
    required this.leftPressure,
    required this.rightPressure,
    required this.accel,
    required this.gyro,
    required this.copX,
    required this.copY,
    required this.risk,
    required this.context,
    required this.state,
    required this.battery,
    required this.cueActive,
    required this.cueMode,
    required this.freezeIndex,
    required this.stepVariability,
    required this.asymmetry,
    required this.turningRisk,
    required this.cadenceBpm,
  });

  List<double> get pressure => [...leftPressure, ...rightPressure];
}

extension GaitStateX on GaitState {
  String get label => switch (this) {
        GaitState.normal => '정상 보행',
        GaitState.warning => '전조 경고',
        GaitState.fog => '동결 위험',
        GaitState.recovery => '회복 단계',
      };
}

extension GaitContextX on GaitContext {
  String get label => switch (this) {
        GaitContext.walking => '직선 보행',
        GaitContext.turning => '방향 전환',
        GaitContext.standing => '정지 상태',
      };
}

extension CueModeX on CueMode {
  String get label => switch (this) {
        CueMode.none => '대기',
        CueMode.haptic => '햅틱',
        CueMode.audio => '청각',
        CueMode.laser => '시각',
        CueMode.multisensory => '복합 큐잉',
      };
}
