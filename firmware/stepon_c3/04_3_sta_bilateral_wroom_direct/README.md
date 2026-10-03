# 4-3 · WROOM 압력센서 4개 직접 입력

기존 `04_2_sta_bilateral_wroom`과 별개인 샘플용 스케치입니다. **압력용 CD74HC4067을 제거하고 FSR 4개를 ESP32 ADC1에 직접 연결**합니다. BMI270, DRV2605L, 레이저 출력, Wi-Fi STA·웹 자동 등록, FoG 출력 제어는 4-2의 현재 기능을 유지합니다.

Arduino IDE에서 같은 폴더의 **`04_3_sta_bilateral_wroom_direct.ino`**를 여세요. `config.h`, `sensor_core.h`, `wifi_diagnostics.h`도 같은 폴더에 있어야 합니다. 기존 4-2 파일을 덮어쓰지 않습니다.

## 핀맵

한 발당 ESP32 1대 기준이며, 표의 숫자는 GPIO 번호입니다.

| 부품 / 위치 | 연결 |
|---|---|
| 압력 P1 · 앞쪽 | GPIO **34** |
| 압력 P2 · 가운데 안쪽 | GPIO **35** |
| 압력 P3 · 가운데 바깥쪽 | GPIO **32** |
| 압력 P4 · 뒤꿈치 | GPIO **33** |
| BMI270 · DRV2605L · TCA9548A 상위 SDA | GPIO **21** |
| BMI270 · DRV2605L · TCA9548A 상위 SCL | GPIO **22** |
| SHTC3 T1~T4 | TCA의 **SD3/SC3, SD4/SC4, SD5/SC5, SD6/SC6**에 각 1개 |
| 레이저 제어 | GPIO **27** → 기존 저항·2N2222 구동 회로 |
| 센서 전원 / 공통 접지 | **3.3V / GND** |

압력센서마다 다음 분압 회로를 각각 사용합니다. 저항 4개가 필요합니다.

```text
3.3V ─ FSR ─┬─ 해당 GPIO34 / 35 / 32 / 33
            └─ 10kΩ ─ GND
```

전원을 끄고 배선을 변경하세요. 기존 MUX S0/S1에 꽂혔던 GPIO32/33 선은 빼고 압력 입력에 사용합니다. CD74HC4067의 S0/S1/S2/S3/SIG 연결은 이 버전에서 사용하지 않습니다. ADC 입력에 5V를 넣지 않습니다. GPIO34/35에는 내부 풀다운이 없어 위의 외부 저항을 생략하면 입력이 뜰 수 있습니다.

온습도용 **TCA9548A는 계속 사용합니다.** 제거하는 것은 압력용 아날로그 MUX뿐입니다. TCA 주소는 **0x71**(A0=3.3V, A1/A2=GND), SHTC3는 **0x70**, BMI270은 **0x68**, DRV2605L은 **0x5A**입니다. 동일 주소 SHTC3 4개를 21/22에 병렬로 직결하지 않습니다.

ADC1 GPIO32~35를 사용한 근거와 Wi-Fi 사용 중 ADC2 제한은 [Espressif ADC 문서](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/peripherals/adc.html), GPIO34/35의 입력 전용·내부 저항 제한은 [Espressif GPIO 정의](https://github.com/espressif/esp-idf/blob/master/docs/en/api-reference/peripherals/gpio/esp32.inc)를 참고하세요.

## 업로드

1. 실제 일반 WROOM 보드는 **ESP32 Dev Module**, 실제 WROOM-DA는 **ESP32-WROOM-DA Module**을 선택합니다. C3/S3용 코드가 아닙니다.
2. `config.h`의 `STEPON_RIGHT_FOOT`를 왼발 **0**, 오른발 **1**로 설정합니다. 기존 설정을 가져와 기본값은 **오른발(1)**입니다. 4개 독립 센서 구성으로 고정되어 별도의 프로필 변경은 필요 없습니다.
3. 이 PC의 작업 폴더에는 기존 4-2의 `wifi_secrets.h`를 복사했습니다. 공유 ZIP에는 비밀번호가 제외되어 있으므로 ZIP을 쓰면 `wifi_secrets.example.h`를 `wifi_secrets.h`로 복사하고 Wi-Fi 정보를 입력합니다.
4. `config.h`의 `PC_HOST`를 **현재 노트북의 Wi-Fi IPv4**로 맞춥니다. 기존 4-2의 값을 복사했으므로 네트워크가 바뀌었다면 다시 확인하세요. 휴대폰 핫스팟의 게이트웨이 주소가 아닙니다.
5. 보드에 업로드한 뒤 시리얼 모니터 **115200**에서 다음을 확인합니다.

```text
StepOn 04_3_sta_bilateral_wroom_direct foot=right
[PRESSURE] PROFILE=4 DIRECT_ADC1 raw P1(GPIO34)=... P2(GPIO35)=... P3(GPIO32)=... P4(GPIO33)=...
[PC] registration HTTP=200
```

한 센서만 누르면 해당 P 값이 주로 증가하는지 확인하세요. `pressure_ready`는 ADC를 읽었다는 뜻이며 FSR 배선의 물리적 연결 확인은 아닙니다. 압력·온습도·IMU 중 일부가 없어도 Wi-Fi는 연결을 계속 시도합니다.

## 웹 연결과 보정

이번 코드에 새 펌웨어 식별자를 받는 웹 호환 처리를 추가했습니다. 실행 중이던 웹은 작업을 마친 뒤 **`run-web.bat --restart`**로 재시작해야 4-3을 인식합니다. 이 작업에서는 실행 중인 웹이나 실제 ESP32를 재시작/업로드하지 않습니다. 웹 재시작 후 발 기울기 기준은 다시 기록하세요.

서버를 처음 켜는 경우 저장소의 `run.bat`을 사용합니다. 보드가 연결되면 기기 설정에서 해당 발을 확인하고 **BMI·압력 보정을 다시 진행**하세요. 센서 수·배선이 달라졌으므로 기존 두 센서 또는 MUX 보정값을 그대로 쓰지 않습니다. 보정 첫 5초에는 양발을 편히 딛고 서 있으며, 그때의 센서별 기준값을 **50점**으로 저장합니다. 이후 20초는 기존 BMI 보행 보정을 진행합니다. 움직일 때도 같은 압력 기준으로 비례 환산합니다.

`/api/state`의 압력 필드는 다음과 같습니다.

```json
{
  "firmware": "04_3_sta_bilateral_wroom_direct",
  "sensor_profile": "four-independent",
  "pressure_transport": "direct-adc1",
  "pressure_channels": [0, 1, 2, 3],
  "pressure_input_gpio": [34, 35, 32, 33],
  "pressure_sensor_map": [0, 1, 2, 3]
}
```

`pressure_channels`는 웹에서 쓰는 논리 순서이며 MUX 채널이나 ESP32 ADC 채널 번호가 아닙니다. 실제 핀 번호는 `pressure_input_gpio`입니다. `pressure_raw`는 12비트 ADC 원본이고, 보드의 `pressure`는 원본을 0~100으로 환산한 보정 전 값입니다. 서 있을 때 50점이 되는 개인 보정은 PC에서 적용합니다.

FOG 레이저는 DRV2605 인식 여부와 별도로 동작하도록 수정했습니다. 레이저·진동 중 사용 가능한 출력에만 명령을 적용하며, 감지 중지·통신 임대 만료 조건은 유지합니다.

라이브러리: **SparkFun BMI270 Arduino Library**, **Adafruit DRV2605 Library**, **Adafruit BusIO**. 빌드 결과는 `VERIFICATION.md`에 기록합니다.
