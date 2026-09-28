# StepOn 로컬 웹 테스트 서버

ESP32-C3에 업로드하지 않고 컴퓨터에서 대시보드를 먼저 테스트할 때 사용합니다. ESP32 펌웨어 안에 들어 있는 대시보드 HTML을 그대로 읽어 제공하고, `/api/state`에는 테스트용 센서값을 반환합니다.

첫 화면에서 성별·연령대·관찰 목적을 선택합니다. 관찰 목적은 보행 동결 관찰, 당뇨발 위험 관찰, 자세·궤적 추적을 여러 개 선택할 수 있습니다. 선택 후에는 목적별로 다른 알고리즘과 상태를 보여줍니다. 파킨슨은 6초 FI 윈도우·FoG 상태머신, 당뇨발은 압력 hotspot·온습도 컨텍스트, 자세는 Roll/Pitch·stance·ZUPT 궤적을 우선 표시합니다.

## 실행

프로젝트 루트에서:

```powershell
python web/local_dashboard/server.py
```

브라우저에서 [http://127.0.0.1:8000](http://127.0.0.1:8000)을 엽니다.

Python 명령이 PATH에 없다면 Codex 번들 Python으로 실행할 수 있습니다.

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" web/local_dashboard/server.py
```

휴대폰 등 같은 네트워크의 다른 기기에서 보려면 서버를 다음처럼 엽니다. Windows 방화벽 허용이 필요할 수 있습니다.

```powershell
python web/local_dashboard/server.py 0.0.0.0 8000
```

## API

- `GET /api/state` — 압력 16채널, IMU, 온습도, COP, 배터리, 연구용 위험지표
- `GET /api/summary` — 로컬 테스트용 로그 저장 상태와 요약 파일 상태
- `GET /api/log.csv` — 테스트 CSV 다운로드
- `POST /api/log/clear` — 테스트 로그 카운터 초기화
- `GET /api/ping` — 서버 상태 확인
- `POST /api/profile` — 온보딩에서 선택한 사용자 정보와 관찰 목적 저장

당뇨발 모드는 혈당이나 당뇨를 측정하지 않습니다. 현재 SHTC3가 한 개이므로 양발 대응 부위 온도 차이는 `추가 센서 필요`로 표시합니다.

나중에 ESP32 실기기와 연결할 때는 프론트엔드의 API 주소를 `http://192.168.4.1/api/state`로 바꾸면 같은 화면을 재사용할 수 있습니다.

실제 ESP32에서는 같은 화면이 `/api/summary`, `/api/log.csv`, `/api/log/clear`도 사용합니다. ESP32 내부 파일은 `/stepon_log.csv`와 `/stepon_summary.json`이며, 로컬 서버에서는 같은 파일 구조를 모의 API로 재현합니다.
