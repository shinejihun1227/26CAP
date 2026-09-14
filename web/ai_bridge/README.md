> 최신 Windows 실행은 저장소 루트의 `setup-ai.bat`(최초 1회) → `run.bat`입니다. [통합 실행 안내](../../docs/RUNNING.md)를 먼저 참고하세요.

# StepOn AI bridge v2

현재 실행·보정·CSV 분석 안내: [AI 통합 가이드](../../docs/AI_INTEGRATION.md).

기본 실행은 `python web/ai_bridge/server.py`입니다. 웹의 양발 수집 이력을 읽으며, `.stepon-data/ai/left.calibration.json`과 `right.calibration.json`을 각각 사용합니다. 보정이 없으면 웹에서 실센서 보정을 시작할 수 있습니다.

`--esp32-url`, `--foot`, `--calibration`은 이전 한 발 AP 연결용입니다. 실행 옵션은 `--help`로 확인합니다. `run.bat`은 웹 8000/8001과 AI 8787을 함께 시작합니다.

모델 가중치는 ZIP 그대로이며 개인 보정 없이 정상 또는 0점으로 표시하지 않습니다. 압력·온습도·MediaPipe는 별도 관찰 지표입니다.
