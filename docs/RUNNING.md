# StepOn 웹·AI 실행 안내 — Windows

**현재 설정한 PC에서는 저장소 폴더의 `run.bat`을 더블클릭하면 됩니다.** 웹과 AI가 함께 켜집니다. 새 PC에서는 아래 최초 설치를 먼저 진행하세요. 모든 명령은 `run.bat`이 들어 있는 저장소 최상위 폴더 기준입니다.

## 1. GitHub에서 받기

[`26CAP / wongi`](https://github.com/shinejihun1227/26CAP/tree/wongi) 브랜치 전체를 받습니다. GitHub **Code → Download ZIP**을 사용하면 압축을 모두 푼 뒤 실행하세요. Git이 설치되어 있으면 PowerShell에서:

```powershell
git clone --branch wongi --single-branch https://github.com/shinejihun1227/26CAP.git
cd 26CAP
```

웹 소스, RF/CNN 모델 가중치, Python 연결 코드, 실행 파일이 함께 들어 있습니다. `ai_engine` 또는 웹 폴더 하나만 받으면 전체 실행에 필요한 파일이 빠집니다. GitHub는 이 코드를 배포하는 곳이며, 서버는 사용자의 PC에서 실행됩니다.

## 2. 새 PC에서 최초 1회 설치

1. **Node.js 24 LTS**를 [공식 다운로드](https://nodejs.org/en/download)에서 설치합니다. 웹 서버 실행에 필요합니다.
2. **64비트 Python 3.12**를 설치합니다. [공식 Windows 설치 안내](https://docs.python.org/3/using/windows.html)의 Python install manager를 사용한다면 `py install 3.12`로 버전을 설치할 수 있습니다. 이미 3.12가 있으면 그대로 사용합니다.
3. 설치 후 새 PowerShell을 열고 아래처럼 확인합니다.

```powershell
node --version
py -3.12 --version
```

`py` 없이 Python 3.12를 설치한 환경은 `python --version`으로 확인할 수 있습니다. 설치를 완료한 뒤 저장소 폴더에서:

```powershell
.\setup-ai.bat
```

이 명령은 `.venv-ai`를 만들고 NumPy/SciPy/pandas/scikit-learn/joblib/PyTorch와 `ai_engine`을 설치합니다. 처음에는 인터넷이 필요하고 PyTorch 다운로드 때문에 시간이 걸릴 수 있습니다. 성공 메시지 `AI dependencies installed`가 나오면 완료입니다. 더블클릭 후 오류 창이 바로 닫히면 위처럼 PowerShell에서 실행하여 오류를 확인하세요.

웹에는 별도의 `npm install`이나 빌드 명령이 필요하지 않습니다. 학습된 RF/CNN 가중치는 저장소에 포함되어 있으며 CUDA 설치, 모델 재학습, OpenAI API 키가 필요하지 않습니다. 다른 PC에는 가상환경을 복사하지 말고 그 PC에서 `setup-ai.bat`을 실행하세요.

## 3. 매번 실행할 파일

**기본 사용은 `run.bat` 하나입니다.** AI를 별도로 한 번 더 실행할 필요가 없습니다.

| 파일 | 언제 쓰나요? | 켜지는 프로그램 |
|---|---|---|
| `setup-ai.bat` | 새 PC의 첫 설치 / AI 의존성 변경 후 | Python 가상환경·라이브러리 설치 |
| `run.bat` | 평소 전체 사용 | 웹·센서 수집 8000 + 편집 화면 8001 + AI 8787 |
| `run-web.bat` | 웹·센서 화면 또는 카메라만 사용 | 웹 8000 + 편집 화면 8001 |
| `run-ai.bat` | 웹을 켠 상태에서 AI만 추가 | AI 8787 |
| `stop.bat` | 기록·분석을 마친 뒤 종료 | 이 폴더에서 실행한 세 서버 종료 |

기본 실행은 이미 실행 중인 같은 StepOn 서버를 재사용합니다. `run.bat`을 다시 눌러도 진행 중인 서버를 바로 재시작하지 않습니다. `run-web.bat`은 AI를 새로 켜지 않으며 이미 켜져 있는 AI를 종료하지도 않습니다.

```powershell
.\run.bat
```

브라우저 창과 실행 안내 창을 닫아도 서버는 백그라운드에서 계속 실행됩니다. 종료할 때는 기록과 분석을 끝낸 뒤 `stop.bat`을 실행합니다. 종료 스크립트는 포트의 프로세스가 이 폴더의 실행 파일인지 확인하며, 진행 중인 CSV 수집·분석·개인 보정이 있으면 종료하지 않고 안내합니다. 저장한 CSV와 보정값은 삭제하지 않습니다.

업데이트한 서버 코드를 반영할 때는 기록·분석을 끝내고 다음 중 하나를 사용합니다.

```powershell
.\stop.bat
.\run.bat
```

또는 `run.bat --restart`로 명시적으로 재시작할 수 있습니다. 이 옵션은 실행 중인 작업도 중단할 수 있으므로 먼저 작업을 마치세요. `run-web.bat --restart`, `run-ai.bat --restart`는 해당 서버만 재시작합니다.

## 4. 어떤 주소를 열면 되나요?

| 화면 | PC에서 여는 주소 |
|---|---|
| 실제 센서 + AI 실시간 화면 | http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0 |
| AI 상태·개인 IMU 보정 | http://127.0.0.1:8000/?view=safety&esp32=1&transport=sta&ai=1&mobile=0 |
| CSV 기록·업로드·분석 | http://127.0.0.1:8000/data/ |
| 웹 편집 화면 | http://127.0.0.1:8001/?mode=editor&screen=live |
| 카메라 관절 움직임 관찰 | http://127.0.0.1:8000/?view=mediapipe |
| AI 서버 상태 확인(JSON) | http://127.0.0.1:8000/api/ai/state |

AI 8787은 웹 화면이 아니라 Python API입니다. 일반 사용에서는 8000번 웹 화면을 이용합니다. 편집 화면은 필요할 때만 열면 됩니다.

## 5. 사용 목적별로 추가 실행할 것

### 이미 저장한 CSV를 분석할 때

`setup-ai.bat` 최초 설치 → `run.bat` → `/data/`만 사용합니다. ESP32, Arduino IDE, 핫스팟, USB 기록 프로그램을 켤 필요가 없습니다. 같은 참가자·회차·발·장치·부착 상태의 **25초 보정 CSV와 측정 CSV**를 선택합니다. [CSV 형식과 수집 동작](DATA_PIPELINE.md)을 참고하세요.

### 실시간 무선 깔창 데이터를 분석할 때 — 04 C3 / 4-2 WROOM STA

1. 처음 보드를 준비할 때만 Arduino IDE에서 C3는 [`04_sta_bilateral`](../firmware/stepon_c3/04_sta_bilateral/README.md), WROOM-32/WROOM-DA는 [`04_2_sta_bilateral_wroom`](../firmware/stepon_c3/04_2_sta_bilateral_wroom/README.md)을 업로드합니다. **C3와 WROOM의 배선과 보드 선택은 다릅니다.** 왼발/오른발 설정, 실제 핫스팟 정보가 들어갈 `wifi_secrets.h`, 보드·라이브러리 설정은 해당 펌웨어 안내를 따릅니다. 실제 Wi-Fi 암호 파일은 GitHub에 포함되지 않습니다. 기존 웹을 실행 중이면 이번 WROOM 지원을 적용할 때 작업을 마친 후 `run-web.bat --restart`로 갱신합니다.
2. PC의 **2.4GHz 모바일 핫스팟**을 켜고 깔창 보드에 전원을 공급합니다. 두 보드가 이 네트워크에 연결되어야 합니다.
3. `run.bat`을 실행하고 웹 **기기 연결**에서 좌우 발과 IMU 수신을 확인합니다.
4. 웹 **보행 분석 센터 → 해당 발 개인 IMU 보정**을 실행합니다. 3초 준비 후 5초 정지, 이어서 20초 일반 보행입니다.
5. 보정 성공 후 새로운 약 4초의 유효 데이터가 들어오면 모델 점수와 상태가 나타납니다.

보드가 이미 업로드되어 있으면 매번 Arduino IDE나 별도 시리얼 프로그램을 실행할 필요가 없습니다. 착용자·부착 방향이 바뀌면 다시 보정합니다. 실제 연결이 없거나 보정이 없으면 점수는 `—`이며 서버 실행 실패와는 다릅니다.

휴대폰은 같은 네트워크에 연결한 뒤 `http://PC의_IP주소:8000/mobile?esp32=1&transport=sta&ai=1` 또는 `http://PC의_IP주소:8000/data/`로 엽니다. 휴대폰의 `127.0.0.1`은 PC를 가리키지 않습니다. PC의 `ipconfig`에서 해당 네트워크의 IPv4 주소를 확인하세요. Node 방화벽 허용은 센서/휴대폰이 접속하는 로컬 네트워크에 맞게 설정합니다.

### USB로 새 CSV를 수집할 때 — 06 WROOM

[`06_bmi270_csv_wroom`](../firmware/stepon_c3/06_bmi270_csv_wroom/README.md)은 일반 ESP32-WROOM-32의 USB 수집 경로입니다. Wi-Fi 웹 연결에는 C3용 04 또는 WROOM용 4-2를 사용하고, USB CSV 기록에는 06을 사용합니다. 사용 중인 하드웨어와 수집 방식에 맞는 경로를 선택합니다.

처음에는 06 펌웨어를 보드에 업로드하고 해당 폴더에서 수집기 의존성을 설치합니다.

```powershell
cd firmware\stepon_c3\06_bmi270_csv_wroom
.\record.bat --install
.\record.bat --list-ports
```

매번 기록할 때만 아래 수집 프로그램을 추가로 실행합니다. `COM7`은 예시이며 실제 포트로 바꾸세요. Arduino 시리얼 모니터/플로터는 먼저 닫습니다.

```powershell
.\record.bat --port COM7 --seconds 25 --label calibration --side left --placement shoe
.\record.bat --port COM7 --seconds 60 --label walking --side left --placement shoe
```

보정의 첫 유효 샘플부터 5초 정지 + 20초 보행을 맞추세요. USB 수집기에는 웹 기록의 3초 준비 시간이 없습니다. `recordings/`의 두 CSV를 웹 `/data/`에서 연결합니다. USB 기록만 할 때는 웹이나 AI를 켤 필요가 없고, 기록한 CSV를 분석할 때 `run.bat`을 사용합니다. 06 보드는 04처럼 웹에 자동 등록되지 않습니다.

### 카메라 관절 움직임을 관찰할 때

웹에서 카메라 관찰 화면을 열고 측정 시작 및 카메라 권한을 허용합니다. 별도 Python 모델 서버나 별도의 MediaPipe 실행 명령은 필요하지 않습니다. 모델과 실행 자산은 `cap_web/vendor/mediapipe/`에 포함되어 있습니다. 이 기능은 PC의 localhost 화면에서 사용합니다.

해당 폴더의 파일이 누락된 경우에만 인터넷 연결 상태에서 복구합니다.

```powershell
node cap_web/tools/setup-mediapipe.mjs
```

## 6. 실행이 안 될 때

| 현상 | 확인 방법 |
|---|---|
| `Node.js was not found` | Node.js 설치 후 창을 새로 열고 `node --version` 확인 |
| Python 3.12를 찾지 못함 | `py -3.12 --version` 확인. 새 install manager가 있다면 `py install 3.12`로 설치 |
| `AI environment missing` / `No module named ...` | 저장소 최상위에서 `setup-ai.bat` 실행 후 `run.bat` |
| pip 설치 오류 | 설치 완료 여부와 인터넷 확인. 고정된 요구 버전을 임의로 바꾸지 말고 오류를 확인 |
| 포트 8000/8001/8787 사용 중 | 같은 폴더의 서버는 재사용. 다른 프로그램/다른 저장소가 사용 중이면 그 프로그램에서 종료 후 다시 실행 |
| AI 브리지 연결됨, 개인 보정 필요 | 서버는 정상. 실시간은 웹에서 개인 보정, CSV 분석은 보정 CSV 선택 |
| 점수가 계속 `—` | 해당 발 IMU 연결·실제 수신률·보정 완료·새 4초 창 확인 |
| 휴대폰/ESP32만 접속 실패 | 같은 네트워크, PC IPv4, 핫스팟, TCP 8000 방화벽 확인 |
| `stop.bat`이 종료를 거부 | CSV 기록/분석 또는 개인 보정을 마치거나 취소 후 다시 실행 |
| 터미널에서 상대 경로로 수동 실행한 서버를 종료 못함 | 수동 실행한 터미널에서 Ctrl+C. 종료 파일은 확인된 이 폴더의 백그라운드 서버를 대상으로 함 |

실행 로그는 `.codex-output/web-8000.error.log`, `web-8001.error.log`, `ai-8787.error.log`에 있습니다. 저장 데이터와 개인 보정은 `.stepon-data/`에 남습니다. 이 폴더와 `.venv-ai`, 실제 Wi-Fi 암호는 GitHub에 올리지 않습니다.

## 7. 업데이트 받기

일반적으로 clone한 작업 폴더에서 변경 내용을 보관한 뒤:

```powershell
git pull --ff-only origin wongi
```

설치 요구 파일이 바뀌었다면 `setup-ai.bat`을 다시 실행하고, 실행 중인 측정을 마친 뒤 `stop.bat` → `run.bat`으로 새 코드를 반영합니다. ZIP으로 받았다면 새 폴더에 압축을 풀고 가상환경을 다시 설치합니다. 개인 기록이 들어 있는 기존 `.stepon-data/` 폴더는 보존하세요.


## 실행 파일 검증 기록 (2026-09-14)

- 이 PC의 StepOn 8787/8001/8000 서버만 종료하고 각 포트가 닫힌 뒤 재실행하는 과정을 확인했습니다.
- 재실행 후 사용자 데이터 페이지와 편집 화면 HTTP 200, AI API 응답을 확인했습니다. 개인 보정이 없는 상태는 `calibration_missing`으로 유지되며 임의의 점수를 만들지 않습니다.
- 기본 실행을 반복해도 세 서버의 PID가 바뀌지 않는 재사용 동작을 확인했습니다.
- 다른 경로의 프로세스, 진행 중 CSV 작업, 진행 중 개인 보정 상황을 모의 입력으로 검사했고 종료 함수가 호출되지 않았습니다.
- 배치 파일의 CRLF, PowerShell 구문, 실행 대상 경로와 안내 문서 링크를 확인했습니다. 기존 모델·센서 처리 코드는 이번 실행 파일 정리에서 바꾸지 않았습니다.
