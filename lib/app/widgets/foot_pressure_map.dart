import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class FootPressureMap extends StatelessWidget {
  const FootPressureMap({super.key, required this.values});

  final List<double> values;

  static const _positions = <Offset>[
    Offset(0.38, 0.12),
    Offset(0.58, 0.12),
    Offset(0.35, 0.30),
    Offset(0.61, 0.31),
    Offset(0.50, 0.49),
    Offset(0.31, 0.70),
    Offset(0.50, 0.79),
    Offset(0.69, 0.69),
  ];

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 0.72,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final height = constraints.maxHeight;
          final maxValue = values.isEmpty
              ? 1.0
              : values.reduce((a, b) => a > b ? a : b).clamp(1, double.infinity);

          return Stack(
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _FootShapePainter(),
                ),
              ),
              for (var i = 0; i < values.length && i < _positions.length; i++)
                Positioned(
                  left: (width * _positions[i].dx) - 34,
                  top: (height * _positions[i].dy) - 34,
                  child: _SensorNode(
                    label: 'P${i + 1}',
                    value: values[i],
                    intensity: values[i] / maxValue,
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SensorNode extends StatelessWidget {
  const _SensorNode({
    required this.label,
    required this.value,
    required this.intensity,
  });

  final String label;
  final double value;
  final double intensity;

  @override
  Widget build(BuildContext context) {
    final color = Color.lerp(
      StepOnColors.sky.withValues(alpha: 0.30),
      StepOnColors.danger,
      intensity.clamp(0.0, 1.0),
    );

    return Container(
      width: 68,
      height: 68,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(
            color: StepOnColors.blue.withValues(alpha: 0.15),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value.toStringAsFixed(0),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

class _FootShapePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Color(0xFFEAF1FF),
          Color(0xFFDDE8FF),
        ],
      ).createShader(Offset.zero & size);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..color = StepOnColors.border
      ..strokeWidth = 2;

    final path = Path()
      ..moveTo(size.width * 0.40, size.height * 0.02)
      ..cubicTo(
        size.width * 0.18,
        size.height * 0.10,
        size.width * 0.10,
        size.height * 0.26,
        size.width * 0.17,
        size.height * 0.42,
      )
      ..cubicTo(
        size.width * 0.10,
        size.height * 0.55,
        size.width * 0.10,
        size.height * 0.72,
        size.width * 0.25,
        size.height * 0.92,
      )
      ..cubicTo(
        size.width * 0.40,
        size.height * 1.02,
        size.width * 0.62,
        size.height * 1.02,
        size.width * 0.78,
        size.height * 0.89,
      )
      ..cubicTo(
        size.width * 0.93,
        size.height * 0.71,
        size.width * 0.89,
        size.height * 0.52,
        size.width * 0.82,
        size.height * 0.37,
      )
      ..cubicTo(
        size.width * 0.90,
        size.height * 0.25,
        size.width * 0.84,
        size.height * 0.10,
        size.width * 0.62,
        size.height * 0.02,
      )
      ..close();

    canvas.drawPath(path, fill);
    canvas.drawPath(path, stroke);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
