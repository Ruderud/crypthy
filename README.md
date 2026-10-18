# Crypthy

> 이름은 crypto + smithy(대장간)를 합친 말입니다.

NVIDIA GPU가 달린 **Windows / Ubuntu(Linux)** PC를 위한 **코인 채굴 허브 + PC 관리 + 채굴량·수익 확인** 트레이 앱입니다.

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
- **자동 업데이트**: GitHub Releases에서 새 버전을 받습니다. 지원 대상은 Windows 설치형과 Linux AppImage이며, zip·deb는 수동으로 업데이트합니다.

### 차트

차트는 [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)(Apache-2.0)로 그립니다.

- **GPU별 시계열**: 해시레이트·온도·전력을 1분 평균으로 보여 줍니다. 로컬에 최근 3일치를 저장하며, GPU당 최대 4,320점·최대 16개 GPU까지 기록합니다.
- **코인 시세**: CoinGecko 30일 시세(USD)입니다.
- **일별 채굴량·순수익**: 일별 채굴량은 막대, 순수익(원)은 선으로 그립니다. 순수익은 그날 종가로 환산하고, 종가가 없으면 현재 시세를 씁니다. 전기료는 차감합니다.

### 테마

거래소 대시보드 느낌의 다크 테마가 기본입니다. 노란 강조색, 숫자 등폭 표시, 상승은 초록·하락은 빨강을 씁니다. 상단 버튼으로 다크 → 라이트 → 시스템 순서로 바꿀 수 있습니다. 특정 거래소의 로고·이름·아이콘은 쓰지 않습니다.

### 채굴량·수익

수익은 **추정**과 **확정** 두 가지로 나눠 보여 줍니다.

- **실시간 추정 순수익(원/h)**: 실측 해시레이트 × 풀 통계 기대 채굴량 × 시세에서 실측 GPU 전력비를 뺀 값입니다.
  - 해시레이트는 채굴기 통계 API에서 가져옵니다. 현재 SRBMiner-MULTI(`--api-enable --api-port 21550`)를 지원합니다.
  - 풀 통계는 네트워크 해시, 블록 보상·시간, 수수료입니다. 현재 Kryptex만 지원하며, 지갑을 입력하지 않아도 조회합니다.
  - 오늘·이번 달 추정치는 같은 시간 동안 추정 채굴량과 전력량을 함께 쌓아서 계산합니다.
- **풀 확정 채굴량·순수익**: 풀 공개 API의 누적값(미지급 잔액 + 지급)을 기준으로 합니다.
  - **풀 누적 채굴량**: 앱을 켜기 전에 채굴한 몫까지 포함합니다.
  - **확정 순수익**: 풀 누적이 늘어난 만큼의 채굴량과, 그 증가가 일어나기까지 쓴 전력을 **같은 구간**으로 짝지어 계산합니다.
  - 풀 잔액은 블록·정산 단위로 띄엄띄엄 늘어납니다. 그래서 짝지은 구간이 3시간이 되기 전에는 금액 대신 "집계 중"으로 표시합니다. 앱을 켠 직후나 자정 직후에 전력비만 먼저 잡혀 음수로 보이는 일을 막기 위해서입니다.
- **시세**: CoinGecko에서 가져와 설정의 환율로 원화로 바꿉니다.
  - 조회에 실패하면 마지막 정상 시세를 시각과 함께 씁니다. 30분이 지나면 "지난 시세"로 표시합니다.
  - 한 번도 받지 못했다면 순수익을 계산하지 않고 "시세 없음"으로 표시합니다.
- **0.3.1 이하에서 업데이트하면**: 장부를 자동으로 변환합니다.
  - 풀 누적 기준점은 유지합니다.
  - 예전 일별 값은 전력 구간이 맞지 않아 순수익 계산에서 빼고, 채굴량으로만 표시합니다.
- **GPU별 채굴 vs 대여 비교**(정보 표시만): GPU별 채굴 시간당 순수익과 대여 순수익(표시가 × 호스트 몫 − 임대 중 전력비)을 비교합니다. 다음 경우 재검토 알림을 보냅니다.
  - 대여가 더 유리해졌을 때
  - GPU별로 정한 대여가 기준을 넘었을 때
  - 시세가 기준가 대비 일정 비율 이상 떨어졌을 때
- **Vast 대여 시세**: 로그인 없이 공개 검색(bundles)으로 같은 모델의 1장짜리 매물을 30분마다 조회합니다.
  - 기본적으로 Vast가 인증한 **verified 매물만** 씁니다. 미인증·인증 해제 매물은 최저가 쪽에 몰려 있어 중앙값을 낮추기 때문입니다.
    - 예: 2026-10-18 RTX 5090 온디맨드 매물을 모두 넣으면 $0.699, verified만 넣으면 $0.869입니다.
  - 매물 유형은 온디맨드와 중단 가능(입찰) 중 하나를 고릅니다. 지역은 국가 코드로 걸러 낼 수 있습니다.
  - 같은 GPU의 DLPerf 중앙값의 80%에 못 미치는 매물은 빼고 계산합니다.
  - 표에는 중앙값, 하위 25%, 표본 수, 조회 시각을 함께 표시합니다. 표본이 5개 미만이면 "데이터 부족"으로 표시하고 비교에 쓰지 않습니다.
  - 비교와 재검토 알림은 이 필터를 거친 중앙값을 기준으로 합니다. GPU별 수동값을 넣으면 수동값이 우선합니다.
  - 내 호스트 매물·임대 수익처럼 로그인이 필요한 정보는 v0.4.0 계획에 있습니다(공식 API 키를 암호화 저장, [ROADMAP](docs/ROADMAP.md) 참고).

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

### Ubuntu(Linux) 설치 (x64, NVIDIA 드라이버 + nvidia-smi 필요) — v0.3.0, 실기 미검증

1. [Releases](https://github.com/Ruderud/crypthy/releases)에서 파일을 받습니다.
   - `Crypthy-<버전>-linux-x86_64.AppImage`: 자동 업데이트를 지원합니다.
   - `Crypthy-<버전>-linux-amd64.deb`: 자동 업데이트를 지원하지 않습니다.
2. `SHA256SUMS.txt`와 해시를 비교합니다.
   ```bash
   sha256sum -c SHA256SUMS.txt --ignore-missing
   ```
3. 실행합니다.
   - AppImage:
     ```bash
     chmod +x Crypthy-*.AppImage && ./Crypthy-*.AppImage
     ```
     Ubuntu 22.04 이상에서는 `libfuse2` 패키지가 필요할 수 있습니다.
   - deb:
     ```bash
     sudo apt install ./Crypthy-*.deb
     ```
4. 트레이 아이콘은 Ubuntu 기본 AppIndicator로 표시합니다. 다른 데스크톱 환경에서는 AppIndicator 확장이 필요할 수 있습니다.
5. 설정의 "로그인 시 앱 실행"을 켜면 `~/.config/autostart/crypthy.desktop`을 만듭니다.

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

- **정지 대상**
  - Windows: 카탈로그에서 실행 파일 이름이 확인된 채굴기(`SRBMiner-MULTI.exe`, `peakminer.exe`, `forge.exe`, `arc-miner.exe`)를 `taskkill`로 정지하고, tasklist로 실제로 꺼졌는지 확인합니다.
  - Linux: 릴리스 아카이브에서 이름을 확인한 `SRBMiner-MULTI`, `peakminer`, `forge`를 `/proc`에서 찾습니다. SIGTERM을 보내고, 3초 뒤에도 살아 있으면 SIGKILL을 보냅니다. 같은 이름의 다른 도구(예: Foundry의 `forge`)를 건드리지 않도록, 명령줄에 풀·지갑·알고리즘 인자가 있는 프로세스만 대상으로 삼습니다.
- **컨테이너는 절대 정지하지 않음(Linux)**: 다음 중 하나라도 해당하면 채굴기로 보지 않고, 정지하지도 않습니다. Vast.ai 고객 워크로드 같은 컨테이너를 보호하기 위해서입니다. 판별할 수 없으면 컨테이너로 봅니다.
  - cgroup 경로에 docker / containerd / kubepods / podman / lxc 등이 있음
  - 앱과 다른 PID 네임스페이스에 있거나, 네임스페이스를 읽을 수 없음
  - 조상 프로세스에 containerd-shim / dockerd / runc / conmon 등이 있음 실행 파일 이름이 미확인인 툴(예: quantus-miner)은 정지할 수 없어 알림만 보냅니다.
- **GPU 단위가 아님**: 정지는 채굴기 단위로 이뤄지므로 그 채굴기가 쓰던 GPU가 모두 멈춥니다. Crypthy는 채굴기 인자를 바꿔 다시 실행하지 않기 때문에 특정 GPU만 빼지 못합니다.
- **재시작 없음**: 앱은 채굴기를 다시 시작하지 않습니다.
- **보류 유지**: 보류 중에 채굴기가 다시 실행되면(작업 스케줄러·bat 등) 15초 간격으로 다시 정지합니다. 보류는 앱 재시작·재부팅 후에도 유지되고, 원인을 해결한 뒤 GPU 카드의 **보류 해제**를 누르면 풀립니다.
- **채굴기가 없을 때 생긴 보류**: 게임 중 과열처럼 채굴기가 없을 때 위험 조건이 생겨도 보류가 걸립니다. 보수적인 동작으로, 나중에 채굴기를 켜면 보류를 해제하기 전까지 정지됩니다.
- **감시 경로**: nvidia-smi가 실패해도 채굴기 API의 장치 값(PCI bus 기준)으로 감시를 이어 갑니다. tasklist가 실패하면 알려진 이름 전부에 정지를 시도하고, 확인하지 못하면 critical 알림을 보냅니다. 실행 파일 이름을 모르는 채굴기가 API로만 감지되면 정지할 수 없다고 알립니다.
- **프로세스 이름 일치**: 실행 파일 이름이 정확히 같으면 다른 프로그램도 정지 대상이 될 수 있습니다. 예를 들어 `forge.exe`라는 다른 앱이 이에 해당합니다.
- **자동 정지 끄기**: **설정 → 위험 조건에서 실행 중인 채굴기 자동 정지**를 끄면 정지하지 않고 critical 알림만 반복합니다.
- **정지 실패**: 관리자 권한으로 실행된 채굴기는 비관리자 앱이 끌 수 없습니다. 이때는 critical 알림이 오니 작업 관리자에서 직접 종료하세요.
- **한계**: nvidia-smi `fan.speed`는 드라이버가 지시한 목표 속도(%)이지 실제 RPM이 아닙니다. 팬이 물리적으로 막혀도 0%로 보이지 않을 수 있어서, 최종 안전장치는 온도 규칙입니다.

## 전력 제한 — Linux (관리자 인증 1회)

1. GPU 설정 표에 W를 입력합니다. 그다음 **전력 제한 서비스 설치 (관리자 인증 1회)** 를 누르고 `pkexec` 인증 창에서 승인합니다. 동봉된 `resources/linux/install-power-service.sh`가 root로 다음을 수행합니다.
   - `/usr/local/lib/crypthy/apply_power_limits.py`를 root 소유, 0755 권한으로 복사합니다.
   - systemd 서비스 `crypthy-power-limit.service`(oneshot)를 만듭니다. 부팅할 때 적용되며 `ProtectSystem=strict` 등 보호 옵션을 켭니다.
   - polkit 규칙 `/etc/polkit-1/rules.d/50-crypthy-power-limit.rules`를 만듭니다. **이 사용자만** **이 서비스를 start**하는 것만 허용합니다.
2. 이후 값을 바꾸면 **전력 제한 지금 적용**을 누릅니다. 앱은 `~/.config/Crypthy/power-limits.json`에 PCI bus id와 W만 쓰고, `systemctl start crypthy-power-limit.service`를 실행합니다.
   - polkit JS 규칙을 지원하지 않는 구버전(예: Ubuntu 22.04의 polkit 0.105)에서는 적용할 때마다 `pkexec` 인증 창이 뜹니다.
3. 결과는 `/var/lib/crypthy/power-limit.log`에서 확인합니다.

보안 원칙은 Windows와 같습니다.
- 실행 스크립트는 root 소유입니다. 사용자가 쓸 수 있는 JSON은 데이터로만 읽습니다.
- 값은 PCI bus id 형식과 100~1000 사이 정수만 받고, 최대 16개까지 처리합니다.
- 실행 파일은 고정 경로의 nvidia-smi만 쓰고, 셸을 거치지 않습니다.
- JSON이 아닌 파일은 내용을 로그에 남기지 않습니다.

해제:

```bash
sudo systemctl disable --now crypthy-power-limit.service
sudo rm -f /etc/systemd/system/crypthy-power-limit.service /etc/polkit-1/rules.d/50-crypthy-power-limit.rules
sudo rm -rf /usr/local/lib/crypthy /var/lib/crypthy
sudo systemctl daemon-reload
```

## 전력 제한 — Windows (UAC 1회)

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

- **확인 시점**: Windows 설치형(NSIS)과 Linux AppImage에서 동작합니다. zip·deb는 수동으로 업데이트합니다.
  - 앱 창이 뜬 뒤 몇 초 안에 한 번 확인하고, 이후 1시간마다 확인합니다.
  - 확인 주기는 **설정 → 업데이트 확인 주기**에서 30분~24시간 사이로 바꿀 수 있습니다.
  - 앱 상단과 트레이 메뉴의 **업데이트 확인**으로 바로 확인할 수도 있습니다.
- **새 버전 발견**: 앱 상단 배너와 OS 알림이 함께 뜹니다. 트레이에만 떠 있어도 OS 알림이 오고, 알림을 누르면 창이 열립니다. 배너에서 고를 수 있는 것:
  - 새 버전 번호와 릴리스 노트 요약을 보여 주고, **받기 / 나중에** 를 고를 수 있습니다.
  - **받기**를 누르면 백그라운드로 내려받고 진행률을 보여 줍니다.
  - 다 받으면 다시 안내합니다. 이때는 **지금 재시작해 설치 / 나중에** 를 고를 수 있습니다.
- **나중에**: 같은 버전의 같은 안내를 다음 정기 확인 때까지 다시 띄우지 않습니다. 수동으로 확인하면 바로 다시 보입니다.
- **설치**: **지금 재시작해 설치**를 누를 때만 설치하며, 강제 재시작이나 종료 시 자동 설치는 없습니다.
  - Crypthy는 채굴기를 관리하지 않으므로, 재시작해도 채굴은 계속됩니다.
  - 재시작하는 몇 초~수십 초 동안은 안전 감시만 잠시 멈춥니다.
- **검증**: 받은 파일은 `latest.yml`(Windows) 또는 `latest-linux.yml`(Linux)의 sha512로 확인합니다.
  - 코드 서명이 없으므로 서명 검증(`verifyUpdateCodeSignature`)은 끕니다.
  - 따라서 이 검증은 받은 파일이 GitHub Releases에 올라간 파일과 같다는 것까지만 보장합니다.
- **실패해도 안전**: 업데이트가 실패해도 알림만 남기고, 안전 감시에는 영향을 주지 않습니다.
- **릴리스 노트**: Release 워크플로가 직전 태그 이후의 커밋 제목으로 자동 작성합니다.
- **모의 모드로 확인**: `CRYPTHY_MOCK=1 CRYPTHY_MOCK_UPDATE=1`로 실행하면 가짜 업데이트로 안내 흐름을 확인할 수 있습니다.

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
  - 업데이트: `update_available`, `update_ready`, `update_error`
  - 기타: `status_api`

## 파일 위치

| 파일 | 경로 |
|---|---|
| 설정 | Windows `%APPDATA%\Crypthy\settings.json` · Linux `~/.config/Crypthy/settings.json` |
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
npm run dist:linux  # Linux x64 AppImage + deb + latest-linux.yml (macOS 에서도 빌드됨)
```

모의 모드 옵션:
- `CRYPTHY_MOCK_FANSTOP=<nvidia-smi 번호>`: 30초 뒤 해당 GPU의 팬이 0%가 됩니다.
- `CRYPTHY_MOCK_KILLFAIL=1`: 채굴기 정지에 실패하는 상황을 재현합니다.
- `CRYPTHY_MOCK_IDLE=1`: 채굴기가 없는 상태로 시작합니다.
- `CRYPTHY_MOCK_UPDATE=1`: 가짜 업데이트(v0.9.9)로 업데이트 안내 흐름을 확인합니다.

카탈로그를 수정할 때:
- `catalog/catalog.json`에 출처 URL과 확인일을 남깁니다.
- 테스트가 다음을 강제합니다.
  - 확인된 dev fee에는 출처가 있어야 합니다.
  - 저장소 링크는 GitHub 저장소만 허용합니다.
  - 미확인 툴에는 링크를 넣지 않습니다.

새 채굴기 통계 API는 `src/main/minerApi.ts`의 `MINER_APIS`에 어댑터로 추가합니다.

### 릴리스 (GitHub Actions)

- `CI`: push(main)와 PR마다 ubuntu·windows 매트릭스로 typecheck와 단위 테스트를 실행합니다.
- `Release`: `v*` 태그를 push하면 windows-latest에서 다음을 순서대로 실행합니다. 시크릿은 `GITHUB_TOKEN`만 씁니다.
  1. 태그와 `package.json` 버전이 같은지 확인합니다.
  2. 테스트를 실행합니다.
  3. 빌드합니다.
  4. Windows 잡이 설치 파일, `.blockmap`, `latest.yml`, zip을 올립니다.
  5. 이어서 Linux 잡이 AppImage, `latest-linux.yml`, deb를 올립니다.
  6. 마지막 잡이 모든 바이너리에 대한 `SHA256SUMS.txt`를 올립니다.

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
