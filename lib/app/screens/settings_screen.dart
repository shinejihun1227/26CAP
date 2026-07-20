import 'package:flutter/material.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Setup & Integration')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          Card(
            child: ListTile(
              leading: Icon(Icons.developer_board),
              title: Text('Current source'),
              subtitle: Text('Mock stream is active. BLE repository will replace this later.'),
            ),
          ),
          Card(
            child: ListTile(
              leading: Icon(Icons.bluetooth),
              title: Text('BLE next step'),
              subtitle: Text('ESP32가 pressure[8], imu, risk, state, battery를 보내도록 GATT characteristic을 맞추면 됩니다.'),
            ),
          ),
          Card(
            child: ListTile(
              leading: Icon(Icons.integration_instructions),
              title: Text('MCP note'),
              subtitle: Text('현재 앱 실행 자체에는 MCP가 필요하지 않습니다. GitHub/Notion은 협업 단계에서 붙이면 충분합니다.'),
            ),
          ),
        ],
      ),
    );
  }
}

