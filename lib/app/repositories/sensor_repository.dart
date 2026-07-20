import '../models/sensor_frame.dart';

abstract class SensorRepository {
  Stream<SensorFrame> watchFrames();
  Future<void> dispose() async {}
}

