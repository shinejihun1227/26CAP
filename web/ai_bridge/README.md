# PC AI 브리지

`server.py`는 ESP32의 `GET /api/state`를 읽어 `ai_engine` 모델을 PC에서 실행하고 브라우저용 결과 API를 제공합니다.

루트 README의 Python 설치와 실제 센서 보정 후 저장소 최상위에서:

```powershell
.venv\Scripts\python.exe web/ai_bridge/server.py --esp32-url http://192.168.4.1 --calibration recordings/session.calibration.json --model ensemble
```

대안: `powershell -ExecutionPolicy Bypass -File web/ai_bridge/run_ai_bridge.ps1 -Calibration recordings/session.calibration.json` (`Bypass`는 이 프로세스에만 적용).

| API | 역할 |
|---|---|
| `http://127.0.0.1:8787/api/ai/ping` | 서비스 응답 |
| `http://127.0.0.1:8787/api/ai/state` | 연결/모델/창 상태, 점수, 판정 |
| `http://127.0.0.1:8787/api/ai/events` | 메모리에 유지하는 상태 변경 이벤트 |

수집 목표는 64 Hz이지만 HTTP 지연과 센서 읽기 시간에 따라 실제 신규 프레임 수는 다를 수 있습니다. 같은 `frame`은 중복 처리하지 않고 `millis` 시간축에서 64 Hz로 선형 보간합니다. 보간이 잃어버린 센서 정보를 복구하는 것은 아닙니다.

`detector_loaded=false`이면 라이브러리/모델/보정 파일을, `device_connected=false`이면 Wi-Fi/API를, `window_ready=false`이면 데이터 누적을 확인합니다. `last_error`도 확인하세요. `ok`가 참이라고 임상적 신뢰성이 검증된 것은 아닙니다.

브리지는 압력·온습도를 RF/CNN 입력에 넣지 않고 진동·레이저 명령도 보내지 않습니다. 장치 API 스키마는 최종 펌웨어와 함께 유지해야 합니다.
