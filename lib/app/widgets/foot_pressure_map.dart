import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class BilateralPressureView extends StatelessWidget {
  const BilateralPressureView({
    super.key,
    required this.leftValues,
    required this.rightValues,
    required this.isConnected,
  });

  final List<double> leftValues;
  final List<double> rightValues;
  final bool isConnected;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _SingleFootPressureMap(
            title: '왼발',
            values: leftValues,
            isConnected: isConnected,
            mirrored: false,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SingleFootPressureMap(
            title: '오른발',
            values: rightValues,
            isConnected: isConnected,
            mirrored: true,
          ),
        ),
      ],
    );
  }
}

class _SingleFootPressureMap extends StatelessWidget {
  const _SingleFootPressureMap({
    required this.title,
    required this.values,
    required this.isConnected,
    required this.mirrored,
  });

  final String title;
  final List<double> values;
  final bool isConnected;
  final bool mirrored;

  static const _positions = <Offset>[
    Offset(0.34, 0.19),
    Offset(0.58, 0.16),
    Offset(0.31, 0.34),
    Offset(0.60, 0.35),
    Offset(0.47, 0.52),
    Offset(0.29, 0.73),
    Offset(0.47, 0.82),
    Offset(0.66, 0.72),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.95),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isConnected ? StepOnColors.border : StepOnColors.border.withOpacity(0.7),
        ),
        boxShadow: [
          BoxShadow(
            color: StepOnColors.navy.withOpacity(0.04),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              Chip(label: Text(isConnected ? '활성' : '대기')),
            ],
          ),
          const SizedBox(height: 12),
          AspectRatio(
            aspectRatio: 0.76,
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
                      child: Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.identity()..scale(mirrored ? -1.0 : 1.0, 1.0),
                        child: CustomPaint(
                          painter: _FootShapePainter(isConnected: isConnected),
                        ),
                      ),
                    ),
                    for (var i = 0; i < values.length && i < _positions.length; i++)
                      Positioned(
                        left: (width * _positions[i].dx) - 26,
                        top: (height * _positions[i].dy) - 26,
                        child: _SensorNode(
                          label: 'P${i + 1}',
                          value: values[i],
                          intensity: isConnected ? values[i] / maxValue : 0,
                          isConnected: isConnected,
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SensorNode extends StatelessWidget {
  const _SensorNode({
    required this.label,
    required this.value,
    required this.intensity,
    required this.isConnected,
  });

  final String label;
  final double value;
  final double intensity;
  final bool isConnected;

  @override
  Widget build(BuildContext context) {
    final color = !isConnected
        ? StepOnColors.border
        : Color.lerp(
            StepOnColors.sky.withOpacity(0.34),
            StepOnColors.danger,
            intensity.clamp(0.0, 1.0),
          )!;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(
            color: StepOnColors.blue.withOpacity(isConnected ? 0.18 : 0.05),
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
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            isConnected ? value.toStringAsFixed(0) : 'OFF',
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

class _FootShapePainter extends CustomPainter {
  const _FootShapePainter({required this.isConnected});

  final bool isConnected;

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: isConnected
            ? const [
                Color(0xFFF7FAFF),
                Color(0xFFE8F0FF),
                Color(0xFFDCE7FF),
              ]
            : const [
                Color(0xFFF4F6FA),
                Color(0xFFE8ECF4),
              ],
      ).createShader(Offset.zero & size);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..color = isConnected ? StepOnColors.border : StepOnColors.textSubtle.withOpacity(0.25)
      ..strokeWidth = 2.2;

    final footPath = Path()
      ..moveTo(size.width * 0.45, size.height * 0.12)
      ..cubicTo(
        size.width * 0.22,
        size.height * 0.16,
        size.width * 0.12,
        size.height * 0.32,
        size.width * 0.16,
        size.height * 0.46,
      )
      ..cubicTo(
        size.width * 0.11,
        size.height * 0.58,
        size.width * 0.10,
        size.height * 0.74,
        size.width * 0.24,
        size.height * 0.92,
      )
      ..cubicTo(
        size.width * 0.40,
        size.height * 1.02,
        size.width * 0.60,
        size.height * 1.00,
        size.width * 0.74,
        size.height * 0.88,
      )
      ..cubicTo(
        size.width * 0.90,
        size.height * 0.72,
        size.width * 0.88,
        size.height * 0.54,
        size.width * 0.81,
        size.height * 0.40,
      )
      ..cubicTo(
        size.width * 0.82,
        size.height * 0.27,
        size.width * 0.71,
        size.height * 0.14,
        size.width * 0.55,
        size.height * 0.11,
      )
      ..close();

    canvas.drawShadow(footPath, StepOnColors.navy.withOpacity(0.10), 18, false);
    canvas.drawPath(footPath, fill);
    canvas.drawPath(footPath, stroke);

    final toeFill = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: isConnected
            ? const [Color(0xFFF7FAFF), Color(0xFFDCE7FF)]
            : const [Color(0xFFF4F6FA), Color(0xFFE8ECF4)],
      ).createShader(Offset.zero & size);

    final toeCenters = [
      Offset(size.width * 0.28, size.height * 0.11),
      Offset(size.width * 0.39, size.height * 0.06),
      Offset(size.width * 0.51, size.height * 0.04),
      Offset(size.width * 0.62, size.height * 0.06),
      Offset(size.width * 0.72, size.height * 0.10),
    ];
    final toeRadii = [14.0, 17.0, 19.0, 16.0, 13.0];

    for (var i = 0; i < toeCenters.length; i++) {
      final rect = Rect.fromCircle(center: toeCenters[i], radius: toeRadii[i]);
      canvas.drawOval(rect, toeFill);
      canvas.drawOval(rect, stroke);
    }
  }

  @override
  bool shouldRepaint(covariant _FootShapePainter oldDelegate) =>
      oldDelegate.isConnected != isConnected;
}
