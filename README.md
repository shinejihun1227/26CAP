# StepOn — 웹·센서·RF/CNN AI

Windows에서 웹, 센서 수집, AI 모델을 함께 실행하는 프로젝트입니다. 최신 코드는 **wongi** 브랜치입니다.

## 바로 실행

**이미 설치한 PC: `run.bat` 더블클릭.** 웹 8000, 편집 화면 8001, AI 8787이 함께 실행됩니다.

새 PC는 [상세 설치·실행 안내](docs/RUNNING.md)에 따라 Node.js 24 LTS와 Python 3.12를 설치한 뒤:

```powershell
git clone --branch wongi --single-branch https://github.com/shinejihun1227/26CAP.git
cd 26CAP
.\setup-ai.bat
.\run.bat
```

Git 없이 GitHub **Code → Download ZIP**으로 받아도 됩니다. 전체 압축을 풀고 실행하세요. `setup-ai.bat`은 최초 설치이며, 평소에는 `run.bat`만 사용합니다. AI를 따로 한 번 더 켤 필요가 없습니다.

| 실행 파일 | 역할 |
|---|---|
| [setup-ai.bat](setup-ai.bat) | 최초 Python 환경·모델 라이브러리 설치 |
| [run.bat](run.bat) | 웹 + 편집 화면 + AI 전체 실행 |
| [run-web.bat](run-web.bat) | 웹·센서 화면만 실행 |
| [run-ai.bat](run-ai.bat) | 실행 중인 웹에 AI 추가 |
| [stop.bat](stop.bat) | 기록·분석을 마친 뒤 이 폴더의 서버 종료 |

이미 켜진 서버는 기본적으로 재사용합니다. 브라우저를 닫아도 서버는 백그라운드에서 계속 실행됩니다. 코드를 업데이트했다면 기록을 마친 뒤 `stop.bat` → `run.bat`으로 다시 켜세요. 명시적 `run.bat --restart`도 지원합니다.

## 웹에서 여는 화면

- [실시간 센서 + AI](http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0)
- [AI 상태·개인 IMU 보정](http://127.0.0.1:8000/?view=safety&esp32=1&transport=sta&ai=1&mobile=0)
- [데이터 수집·CSV 분석](http://127.0.0.1:8000/data/)
- [웹 편집 화면](http://127.0.0.1:8001/?mode=editor&screen=live)
- [카메라 관절 움직임](http://127.0.0.1:8000/?view=mediapipe)

위 주소는 프로그램을 실행한 PC에서 사용합니다. 휴대폰은 같은 네트워크에서 `127.0.0.1` 대신 PC의 IPv4 주소로 접속합니다. AI 8787은 웹 화면이 아닌 로컬 Python API입니다.

## 추가 프로그램이 필요한 경우

- **저장된 CSV 분석:** 전체 실행 후 `/data/`. 보정 25초(5초 정지 + 20초 일반 보행)와 같은 착용 상태의 측정 CSV를 선택합니다. 별도 센서나 핫스팟은 필요하지 않습니다.
- **실시간 무선 깔창:** 처음에 C3는 [04 STA 펌웨어](firmware/stepon_c3/04_sta_bilateral/README.md), WROOM-32/WROOM-DA는 [4-2 STA 펌웨어](firmware/stepon_c3/04_2_sta_bilateral_wroom/README.md)를 업로드합니다. 4-2는 실제 배선에 맞춰 SDA13·SCL14, MUX 32·33·18·26, ADC34, 2N2222 제어27을 사용하며 사진의 MUX S2 선만 GPIO25에서 GPIO18로 옮깁니다. 실제 일반 WROOM-32는 ESP32 Dev Module, 실제 DA는 ESP32-WROOM-DA Module을 선택합니다. 이후 PC 2.4GHz 핫스팟, 보드 전원, 웹의 기기 연결·개인 IMU 보정이 필요합니다. Arduino IDE를 계속 켜둘 필요는 없습니다.
- **USB로 새 데이터 기록:** [06 WROOM 수집기](firmware/stepon_c3/06_bmi270_csv_wroom/README.md)의 `record.bat --install`을 처음 한 번 실행합니다. 측정할 때 `record.bat --port 실제COM포트 ...`를 추가 실행하고, 기록 CSV를 웹에 넣습니다.
- **카메라 관찰:** 웹에서 카메라 권한을 허용하고 시작합니다. 별도 MediaPipe 서버를 실행하지 않습니다.

## 문서와 데이터

- [처음 설치, 전체/개별 실행, 센서 연결, 종료, 오류 해결](docs/RUNNING.md)
- [받을 데이터·CSV 형식·수집과 모델 분석](docs/DATA_PIPELINE.md)
- [AI 처리 과정·점수와 최종 상태의 의미](docs/AI_INTEGRATION.md)
- [AI·CSV 연동 검증 기록](docs/AI_VERIFICATION.md)

RF/CNN 가중치는 `ai_engine/data/processed/ml/model_artifact/`에 포함되어 있습니다. `npm install`, 모델 재학습, API 키 없이 로컬에서 실행합니다. 참가자별 보정과 실제 측정 입력이 있어야 해당 데이터의 점수가 나옵니다.

개인 기록·생성 보정은 `.stepon-data/`, 실행 로그는 `.codex-output/`에 저장되고 Git에서 제외됩니다. Wi-Fi 암호 파일과 PC별 `.venv-ai`도 포함하지 않습니다. 실제 착용 데이터의 정확도 검증은 별도로 필요합니다.
