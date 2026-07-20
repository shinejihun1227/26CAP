# StepOn App

StepOn 앱 프로토타입입니다. 현재 단계에서는 실제 BLE 기기 대신 mock 센서 스트림으로 실시간 모니터링 흐름을 먼저 검증합니다.

## 현재 포함 기능

- 실시간 연결 상태 카드
- Risk score / 보행 상태 표시
- 압력 8셀 시각화
- IMU 요약 표시
- 이벤트 로그 자동 누적
- 간단한 일일 리포트 표시
- mock/BLE 소스 전환을 위한 구조 분리

## 폴더 구조

```text
lib/
  app/
    models/
    repositories/
    screens/
    services/
    widgets/
  main.dart
```

## 실행 방법

1. Flutter SDK 설치
2. 프로젝트 루트에서 아래 실행

```bash
flutter pub get
flutter run
```

## 현재 데이터 구조

앱은 아래 형태의 센서 프레임을 기준으로 동작합니다.

```json
{
  "timestamp": "2026-07-20T16:30:00Z",
  "pressure": [120, 95, 110, 80, 60, 140, 170, 150],
  "accel": {"x": 0.12, "y": -0.03, "z": 0.98},
  "gyro": {"x": 1.4, "y": 0.2, "z": 12.1},
  "copX": 0.42,
  "copY": 0.77,
  "risk": 0.63,
  "context": "turning",
  "state": "warning",
  "battery": 87,
  "cueActive": true
}
```

## 다음 단계

1. BLE Repository 구현
2. CSV 내보내기 추가
3. 실시간 차트 패키지 도입
4. 기기 스캔/연결 화면 실제 BLE 로직 연결

## MCP/외부 연동 메모

현재 앱 자체를 만드는 단계에서는 MCP 연동이 필수는 아닙니다.

- GitHub: 저장소 푸시/PR 단계에서 연동 가능
- Notion: 실험 로그/기획 문서 정리 단계에서 연동 가능
- BLE: MCP가 아니라 Flutter 쪽 플랫폼 API로 연결하는 편이 맞음

