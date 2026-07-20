import 'sensor_frame.dart';

class EventLog {
  final DateTime timestamp;
  final GaitState state;
  final GaitContext context;
  final double risk;
  final bool cueActive;
  final CueMode cueMode;

  const EventLog({
    required this.timestamp,
    required this.state,
    required this.context,
    required this.risk,
    required this.cueActive,
    required this.cueMode,
  });
}
