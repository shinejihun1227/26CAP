import 'package:flutter/material.dart';

class PressureGrid extends StatelessWidget {
  const PressureGrid({super.key, required this.values});

  final List<double> values;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      itemCount: values.length,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 2.6,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemBuilder: (context, index) {
        final value = values[index];
        final normalized = (value / 120).clamp(0.0, 1.0);
        final color = Color.lerp(
          Colors.lightBlue.shade100,
          Colors.red.shade300,
          normalized,
        );
        return Container(
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(16),
          ),
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('P${index + 1}', style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text(value.toStringAsFixed(1)),
            ],
          ),
        );
      },
    );
  }
}

