# 4-2 — ESP32-WROOM 양발 Wi-Fi · 웹 · AI 연결

`04_sta_bilateral` 옆에 추가한 **ESP32-WROOM-32 / ESP32-WROOM-DA용** 독립 스케치입니다. Arduino IDE에서 이 폴더의 `04_2_sta_bilateral_wroom.ino`를 여세요. `.ino`와 같은 폴더의 모든 `.h`를 함께 사용합니다.

## 1. 보드와 핀 연결

| 실제 보드 | Arduino IDE 보드 선택 |
|---|---|
| 일반 ESP32-WROOM-32 개발보드 | **ESP32 Dev Module** |
| ESP32-WROOM-DA 개발보드 | **ESP32-WROOM-DA Module** |
| ESP32-C3 MINI | 기존 `../04_sta_bilateral/` 사용 |

현재 검증 도구는 **Arduino ESP32 2.0.11**, SparkFun BMI270 Arduino Library 1.0.3, Adafruit DRV2605 Library 1.2.4, Adafruit BusIO 1.17.4입니다. 라이브러리 매니저에서 BMI270·DRV2605와 요청되는 의존성을 설치하세요. SHTC3는 자체 I²C/CRC 읽기를 사용합니다. 시리얼 모니터는 **115200 baud**입니다.

화면에 나온 `setTxTimeoutMs` 오류는 C3의 USB용 호출을 WROOM의 `HardwareSerial`에 사용해서 발생합니다. 4-2는 UART0의 `Serial.begin(115200)`을 사용합니다. `setRxTimeout`으로 바꿀 필요가 없으며 USB CDC 설정도 사용하지 않습니다. C3/S3 보드를 선택하면 잘못된 핀으로 빌드하지 않도록 오류를 표시합니다.

**기존 C3 배선에서 아래 WROOM 배선으로 변경해야 합니다.** USB·배터리를 분리한 상태에서 연결하고 센서 GND를 공통으로 연결하세요. GPIO 입력은 3.3V 기준입니다.

| 연결 대상 | WROOM GPIO / 설정 |
|---|---|
| BMI270·TCA9548A·DRV2605L I²C SDA | **21** |
| I²C SCL | **22** |
| CD74HC4067 S0 / S1 / S2 / S3 | **16 / 17 / 18 / 19** |
| CD74HC4067 SIG (압력 ADC) | **34** |
| 선택적 레이저 제어 | **23**, 기본 비활성화 |
| 압력 FSR 4개 | C0 앞쪽 / C2 가운데 안쪽 / C4 가운데 바깥쪽 / C6 뒤꿈치 |
| SHTC3 4개 | TCA CH3 / CH4 / CH5 / CH6 |
| TCA9548A 주소 | **0x71**: A0 High, A1/A2 Low |
| BMI270 / DRV2605L 주소 | **0x68 / 0x5A** |

FSR마다 `3.3V → FSR → MUX 채널`, `MUX 채널 → 10kΩ → GND`로 연결합니다. `pressure_ready`는 ADC 읽기 상태이며 FSR의 물리적 연결 여부를 검출하지는 않습니다. SHTC3 주소는 0x70이므로 상위 TCA도 0x70이면 충돌합니다. 하드웨어 주소를 0x71로 맞추세요.

GPIO34는 Wi-Fi를 쓰는 동안에도 사용할 수 있는 ADC1 입력입니다. ADC2의 Wi-Fi 사용 제한은 [Espressif GPIO 안내](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html)를 참고하세요. WROOM-DA의 GPIO2·25는 안테나 제어에 쓰이므로 이번 배선에서 제외했습니다. [WROOM-DA 데이터시트](https://www.espressif.com/sites/default/files/documentation/esp32-wroom-da_datasheet_en.pdf). 설치된 Arduino ESP32 2.0.11은 DA 보드를 선택하면 이 안테나 핀을 자동 설정하므로 실제 모듈에 맞는 보드를 선택합니다. 이 핀맵은 WROVER용이 아닙니다.

## 2. Wi-Fi와 왼발·오른발 설정

1. `wifi_secrets.example.h`를 **같은 폴더의 `wifi_secrets.h`로 복사**하고 PC 핫스팟 이름과 암호를 입력합니다. 이 PC에는 기존 04의 로컬 설정을 복사해 두었습니다. GitHub에는 예제만 포함됩니다.
2. Windows 모바일 핫스팟을 **2.4GHz**로 켭니다. `config.h`의 `PC_HOST = ""`는 DHCP 게이트웨이를 PC 주소로 사용합니다. 일반 공유기에 함께 연결한다면 `PC_HOST`에 **PC의 LAN IPv4 주소**를 입력합니다.
3. `config.h`의 `#define STEPON_RIGHT_FOOT 0`은 **왼발**입니다. 왼발 보드의 COM 포트를 선택해 업로드합니다.
4. **오른발**은 위 값을 `1`로 바꾸고 오른발 보드에 업로드합니다. 한 대만 쓰면 사용할 발 하나만 선택하세요.
5. 시리얼 모니터 115200에서 `StepOn 04_2_sta_bilateral_wroom foot=left/right`, `GOT_IP`, `[PC] registration HTTP=200`을 확인합니다.

두 보드를 모두 같은 발로 설정하면 등록 충돌이 생깁니다. 기존 보드를 교체할 때는 웹의 **기기 관리 → 등록 해제** 후 새 보드를 연결하세요. 변경한 코드가 보드에서 실행되려면 Arduino IDE에서 업로드해야 합니다.

## 3. 웹 실행과 모델 처리

저장소 최상위에서 새 PC는 `setup-ai.bat`을 최초 1회, 평소에는 **`run.bat`**을 실행합니다. 기존 웹이 켜져 있으면 기록·보정·분석을 마친 뒤 `run-web.bat --restart`로 이번 WROOM 지원을 반영하세요. 최신 서버는 C3 `04_sta_bilateral`과 WROOM `04_2_sta_bilateral_wroom`을 모두 받습니다.

```text
WROOM 센서 → Wi-Fi → PC의 /api/insoles/register에 자동 등록
          → PC가 각 발의 /api/state 조회
          → 웹 센서 표시·CSV 기록 → PC의 Python RF/CNN → 웹 모델 점수
```

- 실시간 화면: http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=1&mobile=0
- CSV 수집·업로드·분석: http://127.0.0.1:8000/data/
- 웹 **보행 분석 센터 → 해당 발 개인 IMU 보정**에서 3초 준비, 5초 정지, 20초 일반 보행을 진행합니다. 보정 후 약 4초의 새 유효 IMU 데이터가 쌓이면 모델 판단이 표시됩니다.
- RF/CNN은 PC에서 실행합니다. ESP32에는 이 펌웨어만 업로드하며 Python 모델을 넣지 않습니다. 압력·온습도는 웹과 CSV로 전달되고 RF/CNN의 기본 입력은 IMU 6축입니다. 자세한 CSV 형식과 점수 정의는 아래 문서를 따릅니다.
- `imu_ready=false` 또는 보정 누락 상태에서는 유효한 AI 점수를 만들지 않습니다. 실행률 표시만으로 센서 정상 연결을 판단하지 마세요.

자동 등록이 안 되면 PC 서버 실행, `PC_HOST`, 시리얼의 IP, 로컬 네트워크의 TCP 8000 방화벽 허용을 확인합니다. 웹에서 ESP32의 IP를 직접 등록할 수도 있습니다.

## 4. 측정 동작과 검증

센서 처리와 Wi-Fi 진단 모듈은 기존 04와 같습니다. BMI270 ODR 100Hz / 읽기 목표 64Hz, 압력 목표 20Hz, 온습도 비동기 읽기, 4채널 배열을 유지합니다. HTTP는 최신 프레임을 조회하므로 무손실 64Hz를 보장하지 않습니다. 실제 수신률과 누락 수를 확인하세요.

STA 전용 재접속, 8.5dBm 송신 출력 설정, 좌우 개별 등록·진동 명령을 유지합니다. 자동 진동은 기본 꺼진 압력·자이로 규칙이며 RF/CNN 출력에 자동 연결되지 않습니다. 레이저는 기본 비활성화입니다.

컴파일 및 자동 검사 결과는 [VERIFICATION.md](VERIFICATION.md)에 기록합니다. 실물 보드 업로드·배선·무선 연결·센서 실측은 별도 확인이 필요합니다.

- [웹·AI 전체 실행 방법](../../../docs/RUNNING.md)
- [데이터 수집·CSV 형식](../../../docs/DATA_PIPELINE.md)
- [AI 보정과 점수 정의](../../../docs/AI_INTEGRATION.md)
