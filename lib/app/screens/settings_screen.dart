import 'package:flutter/material.dart';

import '../widgets/section_card.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('기기 설정')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SectionCard(
            title: '현재 연결 상태',
            subtitle: '지금은 mock 스트림으로 실시간 화면을 검증하고 있습니다.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('다음 단계에서는 BLE 레포지토리를 붙여 실제 ESP32 신호를 받습니다.'),
                SizedBox(height: 10),
                Text('필수 필드: pressure[8], imu[6], cop[2], risk, context, state, battery'),
              ],
            ),
          ),
          SizedBox(height: 16),
          SectionCard(
            title: 'BLE 연동 메모',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('1. ESP32가 GATT characteristic으로 센서 프레임 송신'),
                SizedBox(height: 8),
                Text('2. 앱에서 실시간 파싱 후 화면, 로그, 리포트에 연결'),
                SizedBox(height: 8),
                Text('3. 추후 사용자 보정값과 큐잉 강도 설정 화면 추가'),
              ],
            ),
          ),
          SizedBox(height: 16),
          SectionCard(
            title: '기획 포인트',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('이 앱은 의료 진단 앱이 아니라, 일상 보행 위험 모니터링 및 상담 보조용 프로토타입입니다.'),
                SizedBox(height: 8),
                Text('발표에서는 감지-판단-큐잉-기록 흐름이 끊기지 않는 점을 강조하면 좋습니다.'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
