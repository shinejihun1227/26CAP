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
                Text('다음 단계에서는 BLE 레포지토리를 붙여 실제 좌우 인솔 ESP32 신호를 받습니다.'),
                SizedBox(height: 10),
                Text('필수 필드: leftPressure[8], rightPressure[8], imu[6], cop[2], risk, context, state, battery'),
              ],
            ),
          ),
          SizedBox(height: 16),
          SectionCard(
            title: 'AI 조언 기능을 넣는 방법',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('1. 먼저 센서 프레임과 일자별 요약 데이터를 구조화합니다.'),
                SizedBox(height: 8),
                Text('2. 앱 안에서는 규칙 기반 조언 카드로 즉시 피드백을 제공합니다.'),
                SizedBox(height: 8),
                Text('3. 추후 OpenAI API 같은 LLM을 연결해 하루 요약, 위험 패턴 설명, 상담 보조 문장을 생성할 수 있습니다.'),
              ],
            ),
          ),
          SizedBox(height: 16),
          SectionCard(
            title: '주의할 점',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('이 앱은 의료 진단 앱이 아니라, 일상 보행 위험 모니터링 및 상담 보조용 프로토타입으로 표현하는 것이 안전합니다.'),
                SizedBox(height: 8),
                Text('AI 조언도 진단/처방이 아니라 패턴 설명과 사용자/보호자/의료진 참고 정보로 두는 것이 좋습니다.'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
