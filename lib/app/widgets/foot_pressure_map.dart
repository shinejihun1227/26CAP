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
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: isConnected ? StepOnColors.border : StepOnColors.border.withOpacity(0.7),
        ),
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
                        left: (width * _positions[i].dx) - 28,
                        top: (height * _positions[i].dy) - 28,
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
            StepOnColors.sky.withOpacity(0.30),
            StepOnColors.danger,
            intensity.clamp(0.0, 1.0),
          )!;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(
            color: StepOnColors.blue.withOpacity(isConnected ? 0.16 : 0.05),
            blurRadius: 16,
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
            isConnected ? value.toStringAsFixed(0) : 'OFF',
            style: const TextStyle(
              fontSize: 11,
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
  const _FootShapePainter({required this.isConnected});

  final bool isConnected;

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: isConnected
            ? const [Color(0xFFEAF1FF), Color(0xFFD8E6FF)]
            : const [Color(0xFFF2F4F8), Color(0xFFE7EBF2)],
      ).createShader(Offset.zero & size);

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..color = isConnected ? StepOnColors.border : StepOnColors.textSubtle.withOpacity(0.3)
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
  bool shouldRepaint(covariant _FootShapePainter oldDelegate) =>
      oldDelegate.isConnected != isConnected;
}
