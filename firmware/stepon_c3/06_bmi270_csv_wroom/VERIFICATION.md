# 06 BMI270 CSV / WROOM 검증 — 2026-09-12

- 일반 ESP32-WROOM-32 대상 `esp32:esp32:esp32:DebugLevel=none` 컴파일 성공 (exit 0). ESP32 보드 패키지 2.0.11 / SparkFun BMI270 Arduino Library 1.0.3.
- Flash 302,541 bytes (23%), global RAM 22,012 bytes (6%). 빌드는 `.codex-build/06-bmi270-csv-wroom`에만 생성. 연결된 보드 업로드·초기화 없음.
- Python 3.12.14: `python -m unittest discover -s firmware/stepon_c3/06_bmi270_csv_wroom/tests -v` **17/17 통과**. 부분 UART 줄, 긴 노이즈, 비정상 수치/스키마, 64비트 시간, CSV 왕복 읽기, 누락 sequence, 재부팅/보드 교체, 시간 역행, 무응답, USB 읽기 오류, Ctrl+C, 기존 파일 보존 및 WROOM 핀/DRDY 소스 검사 포함.
- 합성 UART fixture는 테스트의 임시 폴더에서만 사용했으며 실제 보행 기록으로 저장하거나 제공하지 않음.
- `record.bat --help` 성공. pySerial 3.5를 **06/.deps**에만 설치하고 import/version 확인. 전역 Python 환경 변경 없음.
- 기존 04 STA 진단/회귀 검사 **8/8 통과**. 00~05 펌웨어, Wi-Fi 자격정보, 웹 서버 코드는 이번 작업에서 수정하지 않음. 상위 README에 06 WROOM 예외와 링크만 추가.
- `recordings/`, `.deps/`, `__pycache__/`와 `.codex-build/`의 Git 제외 확인. Git commit/push 없음.

## 실물에서 남은 확인

1. 일반 ESP32-WROOM-32 개발보드에 BMI270 3.3V/GND/SDA21/SCL22 연결 후 06 업로드.
2. 230400 baud에서 CHIP_ID/초기화 성공, `ready=1`, 유한한 6축 값 확인. PC 기록 전 Arduino 시리얼 모니터/플로터 닫기.
3. 정지 및 짧은 보행을 각각 기록하고 CSV 축 변화·실제 읽기율·범위 한계·오류/누락·종료 후 파일을 확인.
4. 실제 센서의 DRDY 타이밍, UART·전원 안정성, 무손실 수집은 아직 검증하지 않음. 100Hz는 ODR 설정이며 FIFO 없는 폴링 구조는 모든 하드웨어 샘플 보존을 보장하지 않음.
5. 각도·거리·FoG·보행 구간 자동 판정 및 기존 AI 모델 호환성은 이번 범위가 아님.
