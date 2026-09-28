# 02_wifi_api — Wi-Fi 연결 확인

현재 센서 구성: 압력 4개는 앞쪽 C0·가운데 안쪽 C2·가운데 바깥쪽 C4·뒤꿈치 C6, SHTC3 4개는 TCA CH3·4·5·6입니다. `/api/state`의 `pressure`/`pressure_raw` 배열은 4칸이며 `pressure_count`, `pressure_layout`, `pressure_channels`로 배치를 확인할 수 있습니다. 아래 컴파일 오류 설명은 이전 include 수정 이력입니다.

## 컴파일 오류 수정

기존 `sensor_core.h`는 `../01_sensor_test/sensor_core.h`를 참조했습니다. 원본 파일이 있어도 Arduino의 임시 스케치 빌드에서는 이 형제 폴더 경로를 찾지 못할 수 있습니다. 이제 같은 스케치 폴더의 `sensor_core_local.h`를 포함하므로 1번 테스트 폴더 없이도 프로젝트 헤더를 찾습니다.

다음 세 파일을 같은 폴더에 유지하세요.

```text
02_wifi_api/
  02_wifi_api.ino        # Arduino IDE에서 여는 파일
  sensor_core.h         # 같은 폴더의 구현을 include
  sensor_core_local.h   # 01_sensor_test 센서 구현의 복사본
```

외부 Arduino 라이브러리와 ESP32 보드 패키지는 별도로 필요합니다. 센서 로직·핀맵·AP 설정은 이번 수정으로 변경하지 않았습니다. 센서 설정을 바꾸려면 이 폴더의 `sensor_core_local.h`를 수정하세요.

## 시험 순서

1. Arduino IDE에서 이 폴더의 `02_wifi_api.ino`를 다시 엽니다. 다른 곳에 복사된 예전 스케치가 아닌지 확인하세요.
2. 보드 `ESP32C3 Dev Module`, 해당 USB 포트, USB CDC On Boot `Enabled`를 선택합니다. 시리얼 모니터는 115200 baud입니다.
3. 검증(컴파일) 후 업로드합니다. 외부 라이브러리가 없다는 오류라면 상위 README의 라이브러리 목록을 설치하세요.
4. 시리얼 모니터를 열고 필요하면 보드의 RESET을 한 번 누릅니다. 현재 코드는 센서 초기화 후 Wi-Fi를 시작합니다.
5. 노트북에서 Wi-Fi **StepOn-C3**, 비밀번호 **stepon1234**로 연결합니다. 인터넷 연결 없음 표시는 AP 테스트에서 예상되는 상태입니다.
6. [연결 확인 API](http://192.168.4.1/api/ping)를 엽니다. `ok: true`가 나오면 HTTP 연결이 확인된 것입니다.
7. [센서 상태 API](http://192.168.4.1/api/state)를 엽니다. 새로고침할 때 `frame`과 `millis`가 증가하는지 확인합니다.

현재 `WIFI_SSID`와 `WIFI_PASSWORD`가 빈 문자열이므로 AP 모드로 시작합니다. 두 값을 지정하면 기존 Wi-Fi 접속을 최대 15초 시도하고 실패 시 AP 모드로 넘어갑니다. STA 모드로 연결되면 시리얼에 출력된 IP를 사용하세요.

2번은 50 ms 간격(목표 20 Hz)으로 센서 프레임을 갱신하는 Wi-Fi/API 테스트입니다. 최종 코드의 64 Hz/AI 테스트와 구분하세요. 루트 주소 `/`에는 홈페이지를 넣지 않았으므로 반드시 `/api/ping` 또는 `/api/state`를 엽니다.

AP가 계속 보이지 않으면 컴파일 오류와 별개인 실행 문제입니다. 시리얼 출력에서 `StepOn 02_wifi_api`, 센서 초기화 결과, `AP SSID`, `AP URL`, `HTTP API ready` 중 어디까지 출력됐는지 확인하세요.

참고: [Arduino 공식 빌드 과정](https://docs.arduino.cc/arduino-cli/sketch-build-process/) — 스케치는 임시 디렉터리에서 빌드됩니다.
