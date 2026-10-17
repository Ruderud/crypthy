# Crypthy

> 이름은 crypto + smithy(대장간)를 합친 말입니다.

NVIDIA GPU가 달린 Windows PC에서 [SRBMiner-MULTI](https://github.com/doktor83/SRBMiner-Multi)를 실행하고, 팬·온도를 감시하고, 전력 제한을 관리하는 트레이 앱입니다(MVP).

> **먼저 알아 둘 것**
> - **기본 지갑이 없습니다.** 채굴 수익은 사용자가 입력한 공개 지갑 주소로만 갑니다.
> - **앱 수수료(dev fee)가 없습니다.** 앱은 채굴 시간이나 해시를 가져가지 않습니다.
> - **사용자가 동의하기 전에는 채굴하지 않습니다.** 첫 실행 화면에서 위험·비용 고지에 동의해야 시작 버튼이 동작하고, 자동 시작도 기본으로 꺼져 있습니다.
> - **채굴기를 포함하지 않습니다.** SRBMiner-MULTI는 사용자가 이미 설치한 폴더를 지정하거나, 앱이 공식 GitHub 릴리스에서 내려받아 해시를 검증한 뒤 설치합니다.
> - **코드 서명을 하지 않았습니다.** [Releases](https://github.com/Ruderud/crypthy/releases)마다 `SHA256SUMS.txt`를 함께 올리니 내려받은 파일의 해시를 확인해 주세요.
> - 채굴은 전기 요금이 들고 GPU에 부담을 줍니다. 코인 시세와 난이도에 따라 손실이 날 수 있습니다. 안전 감시는 보조 수단일 뿐입니다.

## 기능

- **대시보드**: GPU별 온도·팬·전력/한도·사용률·해시레이트와 accepted/rejected, 풀 연결·지연을 보여 줍니다. `nvidia-smi` CSV와 SRBMiner API를 2초마다 폴링합니다.
- **채굴 제어**: 시작·정지와 채굴할 GPU 선택(전체 또는 일부)을 지원합니다. 코인 프리셋은 Pearl(PRL, pearlhash)만 켜져 있고 Quantus는 검증 전이라 꺼져 있습니다. 앱이 SRBMiner 인자를 조립해 shell 없이 실행합니다.
- **안전 감시**:
  - 전력이 100W를 넘는데 팬이 0%인 상태가 10초 이상 이어지면 해당 GPU를 즉시 채굴에서 빼고 알립니다.
  - 80°C에서 경고, 85°C에서 해당 GPU를 정지합니다. 기준값은 바꿀 수 있습니다.
  - 온도 값이 끊긴 채 채굴 중이어도 해당 GPU를 뺍니다.
- **GPU 자동 인식·매핑**: GPU는 PCI bus id로 식별합니다. SRBMiner의 GPU id는 nvidia-smi 번호와 다를 수 있어서, SRBMiner API의 PCI bus 정보로 자동 매핑합니다.
- **전력 제한**: GPU별로 W를 설정합니다. 처음 한 번 UAC 승인으로 "가장 높은 권한" 예약 작업을 등록하면 로그온할 때마다 다시 적용됩니다. 앱 본체는 비관리자 권한으로 실행됩니다.
- **수익 패널**(Kryptex 풀 전용): 공개 지갑 주소 기준 미지급 잔액·지급 내역, CoinGecko 시세, 오늘·이번 달 순수익(원)을 보여 줍니다. 순수익에서는 실측 GPU 전력 × 전기 단가를 뺍니다.
- **채굴 vs 대여 비교**(정보 표시만): GPU별 채굴 시간당 순수익과 대여 순수익(표시가 × 호스트 몫 − 임대 중 전력비)을 비교합니다. 다음 경우 재검토 알림을 띄웁니다.
  - 대여 순수익이 채굴 순수익보다 클 때
  - GPU별로 정한 대여가 기준을 넘을 때
  - PRL 시세가 기준가 대비 일정 비율 이상 떨어질 때
- **트레이 상주**: Windows 로그인 시 실행할 수 있습니다(선택, 기본 꺼짐). 설정은 로컬 JSON에 저장합니다.
- **로컬 상태 API**: `GET http://127.0.0.1:47321/v1/status`. 읽기 전용이며 이 PC에서만 접근할 수 있습니다.
- **자동 업데이트**: 설치형(NSIS)에서 GitHub Releases의 새 버전을 확인하고 내려받습니다. 설치는 사용자가 누를 때만 합니다(아래 "자동 업데이트" 참고).

## 하지 않는 것

- 지갑 시드·비밀번호·토큰을 요구하거나 저장하지 않습니다(공개 주소만 사용).
- Windows Defender·방화벽 등 보안 설정을 바꾸지 않습니다. 보안 프로그램이 채굴기를 차단하면 예외를 둘지는 사용자가 직접 판단해 주세요.
- 원격 제어나 쓰기 API가 없습니다. 외부로 보내는 요청은 공개 API 조회뿐입니다.
  - CoinGecko 시세
  - Kryptex 풀 통계와 공개 지갑 주소 기준 잔액
  - Vast.ai 공개 오퍼 검색
  - SRBMiner 릴리스 확인과 Crypthy 업데이트 확인(GitHub)

## 설치 (Windows 10/11 x64, NVIDIA 드라이버 필요)

1. [Releases](https://github.com/Ruderud/crypthy/releases)에서 `Crypthy-<버전>-setup-x64.exe`(설치형, 자동 업데이트 지원) 또는 `Crypthy-<버전>-win-x64.zip`(무설치, 자동 업데이트 없음)을 내려받습니다.
2. 같은 릴리스의 `SHA256SUMS.txt`와 해시가 같은지 확인합니다.
   ```powershell
   Get-FileHash .\Crypthy-0.1.0-setup-x64.exe -Algorithm SHA256
   ```
3. 서명되지 않은 앱이라 SmartScreen 경고가 뜰 수 있습니다. 해시를 확인했다면 **추가 정보 → 실행**을 누릅니다.
4. 설치는 사용자 단위로 이뤄지며(관리자 권한 불필요) 기본 경로는 `%LOCALAPPDATA%\Programs\Crypthy`입니다.

## 처음 설정

앱을 처음 열면 **처음 설정** 카드가 나옵니다. 네 단계를 모두 마쳐야 채굴을 시작할 수 있습니다.

1. **SRBMiner-MULTI**: 둘 중 하나를 고릅니다.
   - **설치된 폴더 지정**: `SRBMiner-MULTI.exe`가 있는 폴더를 고릅니다.
   - **공식 릴리스 확인 → 내려받기·검증·설치**: `doktor83/SRBMiner-Multi`의 최신 릴리스 Windows zip을 내려받습니다. 두 가지로 검증합니다.
     - GitHub API가 제공하는 asset SHA-256 digest
     - 작성자가 같은 릴리스에 올린 `.md5` 파일

     검증을 통과하면 `%APPDATA%\Crypthy\miners\<버전>`에 풉니다. 해시가 다르면 설치를 중단합니다.
2. **지갑·풀**: 공개 지갑 주소에 `.워커명`을 붙여 입력하고, 풀을 `host:port` 형식으로 입력합니다(TLS). 예: `prl.kryptex.network:8048`. 기존 SRBMiner bat 파일이 있으면 **기존 bat에서 가져오기**로 `--wallet`, `--pool` 값을 읽어 올 수 있으며, bat 파일 자체는 수정하지 않습니다.
3. **GPU 매핑**: **매핑 감지**를 누르면 모든 GPU로 SRBMiner를 10~40초 실행해 PCI bus로 짝을 맞춘 뒤 정지합니다. 감지 중에도 안전 감시는 계속되며, 새 제외가 생기면 바로 중단합니다. 안전 제외된 GPU가 있으면 감지를 거부합니다. GPU 설정 표에서 SRBMiner id를 직접 입력해도 됩니다. 채굴 중에도 PCI bus를 기준으로 매핑을 계속 확인하고, 다르면 자동으로 바로잡은 뒤 알립니다.
4. **위험·비용 고지 동의**: 내용을 읽고 체크한 뒤 **동의**를 누릅니다.

그다음 **채굴 제어**에서 GPU를 고르고 **선택한 GPU로 시작**을 누릅니다. 트레이 메뉴에서도 시작할 수 있습니다(선택한 GPU, 전체, GPU 하나만).

### 기존 자동 시작(bat·작업 스케줄러)과 함께 쓸 때

- 앱 밖에서 실행된 SRBMiner는 "외부 실행"으로 표시됩니다.
- 안전 제외가 생기면 앱이 그 채굴기를 넘겨받아, 제외할 GPU를 뺀 인자로 다시 실행합니다.
- 외부 채굴기가 관리자 권한으로 실행됐다면 비관리자인 앱은 그 채굴기를 끌 수 없습니다. 이때 앱은 두 번째 채굴기를 띄우지 않고 critical 알림만 보냅니다. 앱으로 채굴을 관리하려면 기존 자동 시작 작업을 직접 끄고, 앱의 "앱 시작 시 채굴 자동 시작"을 켜 주세요. 앱은 다른 예약 작업을 바꾸지 않습니다.

### 창 닫기와 종료

창을 닫아도 트레이에 남습니다. 트레이 메뉴의 **종료**는 앱만 닫고 채굴기는 계속 돌립니다. 채굴을 멈추려면 **채굴 정지**를 누릅니다.

## 전력 제한 (UAC 1회)

1. **GPU 설정 · 전력 제한** 표에 GPU별 W를 입력합니다. nvidia-smi가 알려 주는 허용 범위 안이어야 하고, 빈칸으로 두면 그 GPU는 건드리지 않습니다.
2. **전력 제한 예약 작업 등록 (UAC 1회)** 을 누르고 UAC 창에서 승인합니다. 관리자 권한으로 실행되는 `resources\ps\register-power-task.ps1`이 다음을 수행합니다.
   - `C:\ProgramData\Crypthy\`이 이미 있으면 지우고 새로 만듭니다. 미리 만들어 둔 폴더의 소유자·권한을 이어받지 않기 위해서입니다.
     - 그 경로가 junction이나 symlink면 따라가 지우지 않고 중단합니다.
     - 하위 항목은 junction을 따라가지 않는 `rmdir /s /q`로 지웁니다.
   - 폴더는 권한을 붙인 채로 한 번에 만듭니다(`Directory.CreateDirectory(path, acl)`). 소유자는 Administrators이고 상속은 차단합니다. Administrators·SYSTEM은 모든 권한, Users는 읽기·실행만 가집니다.
   - 만든 직후 다음 세 가지를 확인하고, 하나라도 어긋나면 중단합니다.
     - 소유자가 Administrators인지
     - reparse point가 아닌지
     - 폴더가 비어 있는지
   - 적용 스크립트 `apply-power-limits.ps1`을 이 폴더에 복사합니다.
   - 예약 작업 `Crypthy-PowerLimit`을 등록합니다. 현재 사용자로, 가장 높은 권한으로, 로그온 30초 뒤에 실행되며 등록 직후 한 번 실행됩니다.
3. 이후 값을 바꾸면 **전력 제한 지금 적용**을 누릅니다. 앱은 `%APPDATA%\Crypthy\power-limits.json`에 값만 쓰고 `schtasks /run`으로 작업을 실행하므로 UAC 창은 다시 뜨지 않습니다.
4. 결과는 표 아래 로그(`C:\ProgramData\Crypthy\power-limit.log`)에서 확인합니다.

보안 메모:
- 예약 작업이 실행하는 스크립트는 일반 사용자가 쓸 수 없는 폴더에 있습니다.
- 사용자가 쓸 수 있는 JSON은 데이터로만 읽습니다. `gpu`는 PCI bus id 형식, `watts`는 100~1000 범위의 정수만 받아 `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`에 넘기고, 실제 허용 범위는 nvidia-smi가 다시 검사합니다. 따라서 같은 사용자 권한의 프로그램이 JSON을 바꿔도 할 수 있는 일은 GPU 전력 제한 값 변경뿐입니다.
- 등록 스크립트 원본은 앱 설치 폴더(사용자 쓰기 가능)에 있습니다. UAC 승인 시점에 그 내용이 관리자 권한으로 실행되므로, 신뢰할 수 있는 설치본에서만 등록하세요.

해제(관리자 PowerShell):

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

## 자동 업데이트

- **확인 시점**: 설치형(NSIS)에서만 동작하며, 앱 시작 1분 뒤와 그 후 6시간마다 [GitHub Releases](https://github.com/Ruderud/crypthy/releases)의 `latest.yml`을 확인합니다(electron-updater). 화면 상단의 버전 표시에서 상태를 볼 수 있습니다.
- **다운로드·검증**: 새 버전은 백그라운드에서 내려받고, `latest.yml`의 sha512 값으로 무결성을 확인합니다. 코드 서명이 없으므로 서명 검증(`verifyUpdateCodeSignature`)은 끕니다. 즉 이 검증은 GitHub Releases에 올라간 파일과 일치하는지까지만 보장합니다.
- **설치**: 다 받으면 알림을 띄우고 상단에 **업데이트 설치** 버튼이 나옵니다.
  - 버튼을 누를 때만 설치하며, 강제 재시작이나 앱 종료 시 자동 설치는 하지 않습니다.
  - 채굴 중이면 먼저 확인 창을 띄웁니다. 채굴기는 앱과 별도 프로세스라 계속 돌지만, 앱이 다시 시작되는 수십 초 동안 안전 감시가 멈춥니다.
  - 설치 후 앱이 다시 열리면 실행 중인 채굴기를 이어서 관리합니다.
- **실패 처리**: 네트워크 오류 등으로 확인이나 다운로드가 실패해도 상태 표시와 알림만 남기고, 채굴과 안전 감시에는 영향을 주지 않습니다.
- zip(무설치) 버전은 자동 업데이트를 하지 않습니다.

## 안전 감시 동작

| 조건 | 동작 |
|---|---|
| 전력 > 100W이고 팬 0%가 10초 이상 | 해당 GPU 채굴 제외 + critical 알림 |
| 온도 ≥ 85°C | 해당 GPU 채굴 제외 + critical 알림 |
| 온도 ≥ 80°C | 경고(77°C 아래로 내려가면 다시 감시) |
| 채굴 중인데 온도 값이 5회(약 10초) 연속 없음 | 해당 GPU 채굴 제외 + critical 알림 |

- **제외 방식**: 해당 GPU의 `--gpu-id`를 뺀 인자로 SRBMiner를 다시 실행합니다. 남는 GPU가 없으면 정지합니다.
- **재실행할 수 없을 때**: 매핑 누락, 설정 오류, 실행 파일 없음 등으로 다시 실행할 수 없으면 채굴 전체를 정지합니다(fail-safe).
- **종료 확인**: 채굴기를 끈 뒤 프로세스가 실제로 사라졌는지 확인합니다. 끄지 못하면 새 채굴기를 띄우지 않고 critical 알림을 보낸 뒤, 15초마다 다시 시도합니다.
- **제외 유지**: 제외 상태는 `runtime.json`에 저장되어 앱을 다시 켜거나 재부팅해도 유지됩니다. 원인을 해결한 뒤 GPU 카드의 **재허용** 버튼으로 풉니다.
- **다시 제외하는 경우**: 외부에서 채굴기가 다시 실행됐거나(PID 변화로 감지) 제외된 GPU가 해시를 다시 내면, 앱이 다시 제외합니다.
- **워치독**: 앱이 실행한 채굴기가 꺼지면 약 6초 뒤 다시 실행합니다. 시간당 최대 5회입니다.
- **한계**: nvidia-smi `fan.speed`는 드라이버가 지시한 목표 속도(%)이고 실제 RPM이 아닙니다. 팬이 물리적으로 막혀도 0%로 보이지 않을 수 있으므로 온도 규칙이 최종 안전장치입니다.

## 수익 계산

- **GPU 채굴 순수익(원/h)**: 다음 순서로 계산합니다. 네트워크 해시·블록 보상·블록 시간·수수료는 Kryptex `pool/stats` 값입니다.
  1. 채굴량 = (GPU 해시 ÷ 네트워크 해시) × 블록 보상 × 시간당 블록 수 × (1 − 풀 수수료)
  2. 수익 = 채굴량 × PRL$ × 환율
  3. 순수익 = 수익 − GPU 실측 W × 전기 단가
- **대여 순수익(원/h)** = 표시가 × 호스트 몫(기본 75%) × 환율 − 임대 중 전력(기본 250W) × 전기 단가
  - 표시가는 GPU별 수동값을 우선 쓰고, 없으면 Vast.ai 공개 검색에서 같은 모델 1장짜리 온디맨드 오퍼의 `dph_total` 중앙값을 씁니다(30분마다 조회).
- **오늘·이번 달 채굴량**: (미지급 잔액 + 지금까지 본 지급액 합계)가 이전 최고치보다 늘어난 만큼을 로컬 날짜별로 더합니다.
  - 지급으로 잔액이 먼저 줄고 지급 내역이 나중에 보여도 이중으로 계산하지 않습니다.
  - 첫 조회 값은 기준점으로만 씁니다.
- **전력량**: 2초마다 nvidia-smi 전력 합계를 적분합니다. GPU 전력만 포함하므로 벽 콘센트 전력보다 작습니다.
- 단위는 원(KRW) 기준이며, 전기 단가와 환율은 설정에서 바꿀 수 있습니다.

## 로컬 상태 API

`GET http://127.0.0.1:47321/v1/status`

```json
{
  "ts": 1792238907285,
  "miner": { "running": true, "mode": "all", "pool": "prl.kryptex.network:8048", "uptime_s": 14, "accepted": 8, "rejected": 0 },
  "gpus": [
    { "index": 0, "name": "NVIDIA GeForce RTX 5090", "temp_c": 63, "fan_pct": 70, "power_w": 581, "power_limit_w": 600, "util_pct": 100, "hashrate": 352793011501620 }
  ],
  "alerts": [ { "ts": 1792238891651, "level": "critical", "code": "fan_stopped", "gpu": "00000000:10:00.0", "message": "..." } ]
}
```

- **접근 제한**: `127.0.0.1`에만 바인딩합니다. Host 헤더가 `127.0.0.1:47321` 또는 `localhost:47321`이 아니면 403을 반환해 DNS rebinding을 막습니다. GET 외 메서드는 405, 다른 경로는 404입니다.
- **크기 제한**: gpus 8개, alerts 20개(최신순), 문자열 120자까지 담습니다. 지갑·설정은 응답에 넣지 않습니다.
- **필드 값**:
  - `mode`: `all`(인식된 GPU 전부) | `partial`(일부) | `external`(앱 밖에서 실행) | `null`(정지)
  - `index`: nvidia-smi 번호. 현재 인식되지 않은 GPU는 `null`
  - `hashrate`: 단위 H/s
  - alert `gpu`: PCI bus id
- **alert code 목록**:
  - 안전: `fan_stopped`, `temp_stop`, `temp_warn`, `telemetry_lost`, `all_excluded`, `failsafe_stop`, `exclude_failed`, `kill_failed`
  - 채굴기 실행: `miner_restart`, `restart_failed`, `miner_launch`, `miner_stop`, `exclusion_cleared`, `srb_mapping`, `autostart_failed`
  - 재검토: `review_rental_price`, `review_rental_better`, `review_prl`
  - 기타: `status_api`

## 파일 위치

| 파일 | 경로 |
|---|---|
| 설정 | `%APPDATA%\Crypthy\settings.json` |
| 실행 상태·안전 제외 | `%APPDATA%\Crypthy\runtime.json` |
| 일/월 장부 | `%APPDATA%\Crypthy\ledger.json` |
| 전력 제한 값 | `%APPDATA%\Crypthy\power-limits.json` |
| 내려받은 SRBMiner | `%APPDATA%\Crypthy\miners\` |
| 전력 제한 스크립트·로그 | `C:\ProgramData\Crypthy\` |

## 개발

```bash
npm install
npm test            # 단위 테스트 (vitest): 파서·안전 감시·수익 계산·상태 API·설치 검증
npm run typecheck
npm run start:mock  # 모의 하드웨어로 UI 확인 (Mac/Linux 가능)
npm run dist:win    # Windows x64 NSIS + zip + latest.yml + release/SHA256SUMS.txt (업로드 안 함)
```

### 릴리스 (GitHub Actions)

- `CI` 워크플로: push(main)와 PR마다 typecheck와 단위 테스트를 실행합니다(ubuntu).
- `Release` 워크플로: `v*` 태그를 push하면 windows-latest에서 실행됩니다.
  1. 태그와 `package.json` 버전이 같은지 확인합니다.
  2. 테스트와 빌드를 실행합니다.
  3. `electron-builder --publish always`로 GitHub Release에 다음 파일을 올립니다: 설치 파일, `.blockmap`, `latest.yml`, zip
  4. `SHA256SUMS.txt`를 추가로 올립니다.

  추가 시크릿은 필요 없고 `GITHUB_TOKEN`만 사용합니다.

```bash
npm version patch --no-git-tag-version   # package.json 버전 올리기
git commit -am "chore: release v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

모의 모드 옵션:
- `CRYPTHY_MOCK_FANSTOP=<nvidia-smi 번호>`: 30초 뒤 해당 GPU의 팬이 0%가 됩니다.
- `CRYPTHY_MOCK_KILLFAIL=1`: taskkill이 실패하는 상황을 재현합니다.

Mac에서 wine 없이 Windows 패키지를 만들 수 있습니다. 코드 서명은 하지 않습니다(`signExecutable: false`).

## 확인이 필요한 가정

- **SRBMiner API 필드명**: 3.7.x 응답을 기준으로 잡았습니다. 실제 장비에서 한 번 확인이 필요합니다.
  - `gpu_devices[].id`, `bus_id`, `model`, `temperature`, `fan_speed_percent`, `asic_power`
  - `algorithms[0].hashrate.gpu.gpu{id}`, `shares.accepted/rejected`, `pool.pool/latency`, `mining_time`

  필드가 없으면 화면에 `-`로 표시될 뿐 앱은 계속 동작합니다. 다만 `bus_id`가 없으면 자동 매핑이 되지 않으므로 SRBMiner id를 직접 입력해야 합니다.
- **Kryptex `miner/payouts` 항목 필드**: 지급 이력이 있는 지갑으로 아직 확인하지 못했습니다. 파서는 `amount`/`value`, `txid`/`id`/시각 중 있는 값을 사용합니다.

## License

[MIT](LICENSE) © 2026 Ruderud

SRBMiner-MULTI는 이 저장소에 포함되지 않으며 자체 라이선스를 따릅니다(doktor83/SRBMiner-Multi).
