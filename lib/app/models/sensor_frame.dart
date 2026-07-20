enum GaitState { normal, warning, fog, recovery }

enum GaitContext { walking, turning, standing }

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
  final List<double> pressure;
  final Vector3Data accel;
  final Vector3Data gyro;
  final double copX;
  final double copY;
  final double risk;
  final GaitContext context;
  final GaitState state;
  final int battery;
  final bool cueActive;

  const SensorFrame({
    required this.timestamp,
    required this.pressure,
    required this.accel,
    required this.gyro,
    required this.copX,
    required this.copY,
    required this.risk,
    required this.context,
    required this.state,
    required this.battery,
    required this.cueActive,
  });
}

