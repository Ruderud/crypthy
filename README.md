# Crypthy

> 이름은 crypto + smithy(대장간)를 합친 말입니다.

NVIDIA GPU가 달린 Windows PC를 위한 **코인 채굴 허브 + PC 관리 + 채굴량·수익 확인** 트레이 앱입니다.

![대시보드 (다크 테마, 모의 데이터)](docs/screenshots/dashboard-dark.png)

<details><summary>라이트 테마</summary>

![대시보드 (라이트 테마, 모의 데이터)](docs/screenshots/dashboard-light.png)

</details>

스크린샷은 모의 모드(`npm run start:mock`)에서 찍은 합성 데이터입니다. 앞으로의 계획은 [docs/ROADMAP.md](docs/ROADMAP.md)를 참고하세요.

> **먼저 알아 둘 것**
> - **채굴기를 설치·실행하지 않습니다.** 코인을 고르면 호환되는 채굴 툴과 공식 저장소 링크를 추천할 뿐이고, 채굴기는 사용자가 직접 설치하고 실행합니다. Crypthy는 실행 중인 채굴기와 GPU를 감시하고 수익을 보여 줍니다.
> - **기본 지갑과 앱 수수료(dev fee)가 없습니다.** 지갑 주소는 풀 공개 통계 조회에만 쓰며, 공개 주소만 입력합니다.
> - **위험할 때는 정지만 합니다.** 팬 정지나 과열 같은 위험 조건이 생기면 실행 중인 알려진 채굴기 프로세스를 정지하고 알립니다. 다시 시작하지는 않으며, 이 동작은 설정에서 끌 수 있습니다.
> - **코드 서명을 하지 않았습니다.** [Releases](https://github.com/Ruderud/crypthy/releases)마다 `SHA256SUMS.txt`를 함께 올리니 내려받은 파일의 해시를 확인해 주세요.
> - 채굴은 전기 요금이 들고 GPU에 부담을 줍니다. 코인 시세와 난이도에 따라 손실이 날 수 있습니다. 안전 감시는 보조 수단일 뿐입니다.

## 기능

### 코인 허브

코인을 고르면 다음을 보여 줍니다.
- 알고리즘
- 이 PC에서 감지한 GPU 벤더(NVIDIA·AMD·Intel)
- 호환 채굴 툴의 추천 순위, 그리고 툴별 공식 저장소 링크·지원 GPU·dev fee·비고

목록은 저장소 안의 큐레이션 파일 [`catalog/catalog.json`](catalog/catalog.json)에서 관리합니다. 값마다 출처 URL과 확인일을 남깁니다. 확인하지 못한 값은 **미확인**으로 표시하고, 공식 저장소를 확인하지 못한 툴은 링크하지 않습니다.

추천 순위는 다음 순서로 정합니다.
1. 이 PC의 GPU 벤더와 호환되는 툴
2. dev fee 확인 상태: 확인됨 → 출처 불일치 → 미확인
3. 확인된 dev fee가 낮은 툴

2026-10-17 기준 카탈로그:

| 코인 | 툴 | GPU | dev fee | 저장소 |
|---|---|---|---|---|
| Pearl (PRL, pearlhash) | SRBMiner-MULTI | NVIDIA, AMD | 2% | [doktor83/SRBMiner-Multi](https://github.com/doktor83/SRBMiner-Multi) |
| | ForgeMiner | NVIDIA | 2% | [kryptex-miners-org/kryptex-miners](https://github.com/kryptex-miners-org/kryptex-miners) (배포처, 개발자 미확인) |
| | PeakMiner | NVIDIA | 3% | 같은 배포처 저장소 |
| | ARCMiner | Intel Arc | 미확인 | 링크 없음(미확인) |
| Quantus (QTC, Poseidon2/QPoW) | ForgeMiner | NVIDIA | 2% | 배포처 저장소 |
| | PeakMiner | NVIDIA | 2% | 배포처 저장소 |
| | SRBMiner-MULTI | NVIDIA, AMD, Intel | 출처 불일치 (2.00% / 2.5%) | doktor83/SRBMiner-Multi |
| | quantus-miner (공식) | wgpu·CUDA | 미확인 | [Quantus-Network/quantus-miner](https://github.com/Quantus-Network/quantus-miner) |

### PC 관리

- **GPU 대시보드**: `nvidia-smi`를 2초마다 읽어 온도·팬·전력/한도·사용률을 보여 줍니다. GPU는 PCI bus id로 식별합니다.
- **안전 감시**: 아래 "안전 감시 동작"을 참고하세요.
- **전력 제한**: GPU별로 W를 정합니다. 처음 한 번 UAC 승인으로 "가장 높은 권한" 예약 작업을 등록하면, 로그온할 때마다 다시 적용됩니다. 앱 본체는 비관리자 권한으로 실행됩니다.
- **트레이 상주**: Windows 로그인 시 실행할 수 있습니다(선택, 기본 꺼짐).
- **로컬 상태 API**: 읽기 전용이며 이 PC에서만 접근할 수 있습니다.
- **자동 업데이트**: GitHub Releases에서 새 버전을 받습니다.

### 차트

차트는 [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)(Apache-2.0)로 그립니다.

- **GPU별 시계열**: 해시레이트·온도·전력을 1분 평균으로 보여 줍니다. 로컬에 최근 3일치를 저장하며, GPU당 최대 4,320점·최대 16개 GPU까지 기록합니다.
- **코인 시세**: CoinGecko 30일 시세(USD)입니다.
- **일별 채굴량·순수익**: 일별 채굴량은 막대, 순수익(원)은 선으로 그립니다. 순수익은 그날 종가로 환산하고, 종가가 없으면 현재 시세를 씁니다. 전기료는 차감합니다.

### 테마

거래소 대시보드 느낌의 다크 테마가 기본입니다. 노란 강조색, 숫자 등폭 표시, 상승은 초록·하락은 빨강을 씁니다. 상단 버튼으로 다크 → 라이트 → 시스템 순서로 바꿀 수 있습니다. 특정 거래소의 로고·이름·아이콘은 쓰지 않습니다.

### 채굴량·수익

- **채굴기 통계 API**: 실행 중인 채굴기의 로컬 통계 API에서 해시레이트·share·풀 지연을 읽습니다. 어댑터 구조이며 현재는 SRBMiner-MULTI(`--api-enable --api-port 21550`)를 지원합니다.
- **풀 공개 API**: 공개 지갑 주소 기준 미지급 잔액·지급 내역을 읽습니다. 현재는 Kryptex 풀(`*.kryptex.network`)을 지원합니다.
- **원화 환산**: 선택한 코인 단위로 오늘·이번 달 채굴량과 순수익(원)을 보여 줍니다. 순수익은 CoinGecko 시세와 환율로 환산한 값에서 실측 GPU 전력 × 전기 단가를 뺀 값입니다.
- **GPU별 채굴 vs 대여 비교**(정보 표시만): 채굴 시간당 순수익과 대여 순수익(표시가 × 호스트 몫 − 임대 중 전력비)을 비교합니다. 다음 경우 재검토 알림을 보냅니다.
  - 대여가 더 유리할 때
  - GPU별로 정한 대여가 기준을 넘을 때
  - 시세가 기준가 대비 일정 비율 이상 떨어질 때

## 하지 않는 것

- 채굴기를 내려받거나 설치·실행·재시작하지 않고, 채굴기 실행 인자도 만들지 않습니다.
- 지갑 시드·비밀번호·토큰을 요구하거나 저장하지 않습니다.
- Windows Defender·방화벽 같은 보안 설정을 바꾸지 않습니다.
- 원격 제어나 쓰기 API가 없습니다. 외부로 보내는 요청은 공개 API 조회뿐입니다.
  - CoinGecko 시세
  - Kryptex 풀 통계·공개 지갑 잔액
  - Vast.ai 공개 오퍼
  - GitHub Releases 업데이트 확인

## 설치 가이드 (Windows 10/11 x64, NVIDIA 드라이버 필요)

1. [Releases](https://github.com/Ruderud/crypthy/releases)에서 `Crypthy-<버전>-setup-x64.exe`를 내려받습니다. 설치형이며 자동 업데이트를 지원합니다. 무설치 버전 `Crypthy-<버전>-win-x64.zip`도 있지만 자동 업데이트는 되지 않습니다.
2. 같은 릴리스의 `SHA256SUMS.txt`와 해시를 비교합니다.
   ```powershell
   Get-FileHash .\Crypthy-0.2.0-setup-x64.exe -Algorithm SHA256
   ```
3. 서명되지 않은 앱이라 SmartScreen 경고가 뜰 수 있습니다. 해시를 확인했다면 **추가 정보 → 실행**을 누릅니다. 설치 화면에서 MIT 라이선스에 동의합니다.
4. 설치는 사용자 단위라 관리자 권한이 필요 없습니다. 기본 경로는 `%LOCALAPPDATA%\Programs\Crypthy`입니다.

### 처음 설정

1. **코인 허브**에서 코인을 고르고, 추천 채굴 툴의 저장소 링크로 가서 채굴기를 **직접** 설치합니다. 출처·해시·dev fee는 각 저장소에서 다시 확인하세요. 보안 프로그램이 채굴기를 차단하면 예외를 둘지는 사용자가 판단합니다.
2. 채굴기를 통계 API를 켠 상태로 실행합니다. SRBMiner-MULTI라면 `--api-enable --api-port 21550`을 붙입니다. 포트를 바꿨다면 **설정 → 채굴기 API 포트**도 같은 값으로 맞춥니다.
3. (선택) **처음 설정 → 지갑·풀**에 공개 지갑 주소에 `.워커명`을 붙여 입력하고, 풀을 `host:port` 형식으로 입력합니다. 풀 공개 통계 조회에만 쓰입니다. 기존 채굴기 bat이 있으면 **기존 bat에서 가져오기**로 `--wallet`, `--pool` 값을 읽어 올 수 있습니다.

### 0.1.x에서 업데이트

- 지갑·풀·전력 제한·안전 기준값·수익 설정은 그대로 유지됩니다.
- 0.1.x의 채굴기 실행 관련 설정(채굴기 폴더, GPU 선택·매핑, 동의 기록)은 더 이상 쓰지 않으므로 버려집니다.
- 0.1.x에서 "안전 제외"였던 GPU는 **안전 보류**로 이어집니다.
- 0.2.0은 채굴기를 시작하지 않습니다. 0.1.x가 시작한 채굴기는 계속 돌지만, 이후 시작·재시작은 직접 해야 합니다.

## 안전 감시 동작

| 조건 | 동작 |
|---|---|
| 전력 > 100W이고 팬 0%가 10초 이상 | 해당 GPU **안전 보류** + 실행 중인 알려진 채굴기 정지 + critical 알림 |
| 온도 ≥ 85°C | 같음 |
| 채굴 중인데 온도 값이 5회(약 10초) 연속 없음 | 같음 |
| 온도 ≥ 80°C | 경고(77°C 아래로 내려가면 다시 감시) |

- **정지 대상**: 카탈로그에서 실행 파일 이름이 확인된 채굴기(`SRBMiner-MULTI.exe`, `peakminer.exe`, `forge.exe`, `arc-miner.exe`)를 `taskkill`로 정지하고, tasklist로 실제로 꺼졌는지 확인합니다. 실행 파일 이름이 미확인인 툴(예: quantus-miner)은 정지할 수 없어 알림만 보냅니다.
- **GPU 단위가 아님**: 정지는 채굴기 단위로 이뤄지므로 그 채굴기가 쓰던 GPU가 모두 멈춥니다. Crypthy는 채굴기 인자를 바꿔 다시 실행하지 않기 때문에 특정 GPU만 빼지 못합니다.
- **재시작 없음**: 앱은 채굴기를 다시 시작하지 않습니다.
- **보류 유지**: 보류 중에 채굴기가 다시 실행되면(작업 스케줄러·bat 등) 15초 간격으로 다시 정지합니다. 보류는 앱 재시작·재부팅 후에도 유지되고, 원인을 해결한 뒤 GPU 카드의 **보류 해제**를 누르면 풀립니다.
- **채굴기가 없을 때 생긴 보류**: 게임 중 과열처럼 채굴기가 없을 때 위험 조건이 생겨도 보류가 걸립니다. 보수적인 동작으로, 나중에 채굴기를 켜면 보류를 해제하기 전까지 정지됩니다.
- **감시 경로**: nvidia-smi가 실패해도 채굴기 API의 장치 값(PCI bus 기준)으로 감시를 이어 갑니다. tasklist가 실패하면 알려진 이름 전부에 정지를 시도하고, 확인하지 못하면 critical 알림을 보냅니다. 실행 파일 이름을 모르는 채굴기가 API로만 감지되면 정지할 수 없다고 알립니다.
- **프로세스 이름 일치**: 실행 파일 이름이 정확히 같으면 다른 프로그램도 정지 대상이 될 수 있습니다. 예를 들어 `forge.exe`라는 다른 앱이 이에 해당합니다.
- **자동 정지 끄기**: **설정 → 위험 조건에서 실행 중인 채굴기 자동 정지**를 끄면 정지하지 않고 critical 알림만 반복합니다.
- **정지 실패**: 관리자 권한으로 실행된 채굴기는 비관리자 앱이 끌 수 없습니다. 이때는 critical 알림이 오니 작업 관리자에서 직접 종료하세요.
- **한계**: nvidia-smi `fan.speed`는 드라이버가 지시한 목표 속도(%)이지 실제 RPM이 아닙니다. 팬이 물리적으로 막혀도 0%로 보이지 않을 수 있어서, 최종 안전장치는 온도 규칙입니다.

## 전력 제한 (UAC 1회)

1. **GPU 설정 · 전력 제한** 표에 GPU별 W를 입력합니다. nvidia-smi가 알려 주는 허용 범위 안이어야 하고, 빈칸으로 두면 그 GPU는 건드리지 않습니다.
2. **전력 제한 예약 작업 등록 (UAC 1회)** 을 누르고 UAC를 승인합니다. 관리자 권한으로 실행되는 `resources\ps\register-power-task.ps1`이 다음을 수행합니다.
   - `C:\ProgramData\Crypthy\` 폴더를 새로 만듭니다.
     - 이미 있으면 지우고 다시 만듭니다. junction/symlink면 따라가지 않고 중단합니다.
     - 권한을 붙인 채로 한 번에 만듭니다: 소유자 Administrators, 상속 차단, Users는 읽기·실행만.
   - 적용 스크립트를 그 폴더에 복사합니다.
   - 예약 작업 `Crypthy-PowerLimit`을 등록합니다. 현재 사용자로, 가장 높은 권한으로, 로그온 30초 뒤에 실행됩니다.
3. 이후 값을 바꾸면 **전력 제한 지금 적용**을 누릅니다. 앱은 `%APPDATA%\Crypthy\power-limits.json`에 PCI bus id와 W만 쓰고, `schtasks /run`으로 예약 작업을 실행합니다.
4. 결과는 표 아래 로그(`C:\ProgramData\Crypthy\power-limit.log`)에서 확인합니다.

보안 메모:
- 예약 작업은 JSON을 데이터로만 읽습니다. PCI bus id 형식과 100~1000 정수만 받아 `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`에 넘깁니다.
- 등록 스크립트 원본은 설치 폴더(사용자 쓰기 가능)에 있습니다. 신뢰할 수 있는 설치본에서만 등록하세요.

해제(관리자 PowerShell):

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

## 자동 업데이트

- **확인 시점**: 설치형(NSIS)에서만 동작합니다. 앱 시작 1분 뒤와 그 뒤 6시간마다 GitHub Releases의 `latest.yml`을 확인합니다(electron-updater).
- **다운로드·검증**: 새 버전은 백그라운드에서 받고 `latest.yml`의 sha512로 확인합니다.
  - 코드 서명이 없으므로 서명 검증(`verifyUpdateCodeSignature`)은 끕니다.
  - 따라서 이 확인은 받은 파일이 GitHub Releases에 올라간 파일과 같다는 것까지만 보장합니다.
- **설치**: 다 받으면 알림과 **업데이트 설치** 버튼이 나오고, 버튼을 누를 때만 설치합니다.
  - 강제 재시작이나 종료 시 자동 설치는 하지 않습니다.
  - 채굴기가 실행 중이면 먼저 확인합니다. 앱이 다시 시작되는 수십 초 동안 안전 감시가 멈춥니다.
- **실패 처리**: 업데이트가 실패해도 알림만 남기고 안전 감시에는 영향을 주지 않습니다.

## 로컬 상태 API

`GET http://127.0.0.1:47321/v1/status`

```json
{
  "ts": 1792238907285,
  "miner": { "running": true, "mode": "external", "pool": "prl.kryptex.network:8048", "uptime_s": 14, "accepted": 8, "rejected": 0 },
  "gpus": [
    { "index": 0, "name": "NVIDIA GeForce RTX 5090", "temp_c": 63, "fan_pct": 70, "power_w": 581, "power_limit_w": 600, "util_pct": 100, "hashrate": 352793011501620 }
  ],
  "alerts": [ { "ts": 1792238891651, "level": "critical", "code": "miner_killed", "gpu": null, "message": "..." } ]
}
```

- **접근 제한**: `127.0.0.1`에만 바인딩합니다.
  - Host 헤더가 `127.0.0.1:47321` 또는 `localhost:47321`이 아니면 403을 돌려줍니다(DNS rebinding 차단).
  - GET이 아니면 405, 다른 경로는 404입니다.
- **응답 크기 상한**: gpus 8개, alerts 20개(최신순), 문자열 120자. 지갑·설정은 응답에 넣지 않습니다.
- **필드 값**
  - `mode`: `external`(채굴기 실행 중. Crypthy는 채굴기를 실행하지 않으므로 항상 이 값) | `null`(채굴기 없음)
  - `hashrate`: H/s
  - alert `gpu`: PCI bus id
- **alert code 목록**
  - 안전: `fan_stopped`, `temp_stop`, `temp_warn`, `telemetry_lost`, `miner_killed`, `miner_killed_again`, `kill_failed`, `safety_hold_running`, `hold_cleared`
  - 재검토: `review_rental_price`, `review_rental_better`, `review_prl`
  - 업데이트: `update_ready`, `update_error`
  - 기타: `status_api`

## 파일 위치

| 파일 | 경로 |
|---|---|
| 설정 | `%APPDATA%\Crypthy\settings.json` |
| 안전 보류 | `%APPDATA%\Crypthy\runtime.json` |
| 일/월 장부 | `%APPDATA%\Crypthy\ledger.json` |
| 차트 기록(최근 3일) | `%APPDATA%\Crypthy\history.json` |
| 전력 제한 값 | `%APPDATA%\Crypthy\power-limits.json` |
| 전력 제한 스크립트·로그 | `C:\ProgramData\Crypthy\` |

## 개발

```bash
npm install
npm test            # 단위 테스트 (vitest)
npm run typecheck
npm run start:mock  # 모의 하드웨어로 UI 확인 (Mac/Linux 가능)
npm run dist:win    # Windows x64 NSIS + zip + latest.yml + SHA256SUMS (업로드 안 함)
```

모의 모드 옵션:
- `CRYPTHY_MOCK_FANSTOP=<nvidia-smi 번호>`: 30초 뒤 해당 GPU의 팬이 0%가 됩니다.
- `CRYPTHY_MOCK_KILLFAIL=1`: 채굴기 정지에 실패하는 상황을 재현합니다.
- `CRYPTHY_MOCK_IDLE=1`: 채굴기가 없는 상태로 시작합니다.

카탈로그를 수정할 때:
- `catalog/catalog.json`에 출처 URL과 확인일을 남깁니다.
- 테스트가 다음을 강제합니다.
  - 확인된 dev fee에는 출처가 있어야 합니다.
  - 저장소 링크는 GitHub 저장소만 허용합니다.
  - 미확인 툴에는 링크를 넣지 않습니다.

새 채굴기 통계 API는 `src/main/minerApi.ts`의 `MINER_APIS`에 어댑터로 추가합니다.

### 릴리스 (GitHub Actions)

- `CI`: push(main)와 PR마다 typecheck와 단위 테스트를 실행합니다.
- `Release`: `v*` 태그를 push하면 windows-latest에서 다음을 순서대로 실행합니다. 시크릿은 `GITHUB_TOKEN`만 씁니다.
  1. 태그와 `package.json` 버전이 같은지 확인합니다.
  2. 테스트를 실행합니다.
  3. 빌드합니다.
  4. GitHub Release에 설치 파일, `.blockmap`, `latest.yml`, zip, `SHA256SUMS.txt`를 올립니다.

## 제3자 소프트웨어 고지

- **TradingView Lightweight Charts™**: 5.2.1, Apache-2.0. Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
  - 라이선스 요구에 따라 차트 안의 TradingView 로고 링크(`attributionLogo`)를 유지합니다.
  - 앱 하단에 출처를 표기합니다.
  - 패키지의 `resources/app.asar/dist/renderer/vendor/`에 LICENSE와 NOTICE를 함께 배포합니다.
  - 원문: [`resources/third-party/lightweight-charts-NOTICE.txt`](resources/third-party/lightweight-charts-NOTICE.txt)
- 그 밖의 런타임 의존성: Electron(MIT), electron-updater(MIT)

## License

[MIT](LICENSE) © 2026 Ruderud

채굴 툴(SRBMiner-MULTI 등)은 이 저장소에 포함되지 않으며, 각자의 라이선스와 dev fee 정책을 따릅니다.
