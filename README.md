**English** | [한국어](README.ko.md) | [简体中文](README.zh-CN.md)

# Crypthy

> The name is crypto + smithy.

A tray app for **Windows / Ubuntu (Linux)** PCs with NVIDIA GPUs: a **coin-mining hub + PC manager + mining output and profit tracker**.

![Dashboard (dark theme, mock data)](docs/screenshots/dashboard-dark.png)

<details><summary>Light theme</summary>

![Dashboard (light theme, mock data)](docs/screenshots/dashboard-light.png)

</details>

The screenshots show synthetic data captured in mock mode (`npm run start:mock`). For upcoming work, see [docs/ROADMAP.md](docs/ROADMAP.md).

> **Read this first**
> - **Crypthy does not install or run miners.** When you pick a coin it recommends compatible mining tools and links to their official repositories. You install and run the miner yourself; Crypthy watches the running miner and your GPUs and shows earnings.
> - **No default wallet and no app fee (dev fee).** The wallet address is used only to read public pool statistics, and you enter only a public address.
> - **On danger it only stops.** If a dangerous condition such as a stopped fan or overheating occurs, Crypthy stops the known miner processes that are running and alerts you. It never restarts them, and this behavior can be turned off in settings.
> - **Builds are not code-signed.** Every [release](https://github.com/Ruderud/crypthy/releases) ships a `SHA256SUMS.txt`; please verify the hashes of the files you download.
> - Mining costs electricity and puts stress on GPUs. Depending on coin price and difficulty you can lose money. The safety watch is only an aid.

## Features

### Coin hub

When you pick a coin, Crypthy shows:
- the algorithm
- the GPU vendors detected on this PC (NVIDIA, AMD, Intel)
- a ranked list of compatible mining tools, with each tool's official repository link, supported GPUs, dev fee and notes

The list is maintained in the curated file [`catalog/catalog.json`](catalog/catalog.json) in this repository. Every value records its source URL and check date. Values that could not be verified are shown as **unverified**, and tools whose official repository could not be confirmed are not linked.

The ranking uses this order:
1. tools compatible with this PC's GPU vendors
2. dev fee status: verified → sources disagree → unverified
3. lower verified dev fee first

Catalog as of 2026-10-17:

| Coin | Tool | GPU | Dev fee | Repository |
|---|---|---|---|---|
| Pearl (PRL, pearlhash) | SRBMiner-MULTI | NVIDIA, AMD | 2% | [doktor83/SRBMiner-Multi](https://github.com/doktor83/SRBMiner-Multi) |
| | ForgeMiner | NVIDIA | 2% | [kryptex-miners-org/kryptex-miners](https://github.com/kryptex-miners-org/kryptex-miners) (distribution, developer unverified) |
| | PeakMiner | NVIDIA | 3% | same distribution repository |
| | ARCMiner | Intel Arc | unverified | no link (unverified) |
| Quantus (QTC, Poseidon2/QPoW) | ForgeMiner | NVIDIA | 2% | distribution repository |
| | PeakMiner | NVIDIA | 2% | distribution repository |
| | SRBMiner-MULTI | NVIDIA, AMD, Intel | sources disagree (2.00% / 2.5%) | doktor83/SRBMiner-Multi |
| | quantus-miner (official) | wgpu·CUDA | unverified | [Quantus-Network/quantus-miner](https://github.com/Quantus-Network/quantus-miner) |

### PC management

- **GPU dashboard**: reads `nvidia-smi` every 2 seconds and shows temperature, fan, power/limit and utilization. GPUs are identified by PCI bus id.
- **Safety watch**: see "Safety watch behavior" below.
- **Power limits**: set watts per GPU. After a one-time admin approval the limits are re-applied automatically (Windows: one UAC prompt registers a scheduled task applied at logon · Linux: one admin authentication installs a systemd service applied at boot). The app itself runs as a normal user.
- **Tray app**: can start at login (optional, off by default).
- **Local status API**: read-only and reachable only from this PC.
- **Auto-update**: downloads new versions from GitHub Releases. Supported for the Windows installer and the Linux AppImage; zip and deb builds are updated manually.

### Charts

Charts are drawn with [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (Apache-2.0).

- **Per-GPU time series**: hashrate, temperature and power as 1-minute averages. The last 3 days are stored locally, up to 4,320 points per GPU and 16 GPUs.
- **Coin price**: 30-day CoinGecko price (USD).
- **Daily output and net profit**: daily mined amount as bars and net profit (KRW) as a line. Net profit uses that day's closing price, or the current price if no close is available, and subtracts electricity.

### Theme

The default is a dark theme in the style of an exchange dashboard: yellow accent, tabular numbers, green for up and red for down. The header button cycles dark → light → system. No exchange's logo, name or icons are used.

### Output and profit

Profit is shown in two separate ways: **estimated** and **confirmed**.

- **Live estimated net profit (KRW/h)**: measured hashrate × expected output from pool statistics × price, minus measured GPU power cost.
  - Hashrate comes from the miner's stats API. SRBMiner-MULTI (`--api-enable --api-port 21550`) is supported.
  - Pool statistics are network hashrate, block reward and time, and fee. Only Kryptex is supported for now, and it is queried even without a wallet.
  - Today/month estimates accumulate estimated output and energy over the same time.
- **Pool-confirmed output and net profit**: based on the pool's public cumulative value (unpaid balance + payouts).
  - **Pool lifetime output** includes what was mined before the app was started.
  - **Confirmed net profit** pairs each increase in the pool total with the energy used until that increase, over **the same period**.
  - The pool balance grows in steps (blocks / settlements), so until the paired period reaches 3 hours the amount is shown as "collecting" instead. This prevents the power cost from appearing first as a negative right after launch or midnight.
- **Price**: from CoinGecko, converted to KRW with the exchange rate in settings.
  - If a request fails, the last good price is used together with its time; after 30 minutes it is marked as a "stale price".
  - If no price was ever received, net profit is not calculated and "no price" is shown.
- **When updating from 0.3.1 or earlier**: the ledger is converted automatically.
  - The pool cumulative baseline is kept.
  - Old daily values cannot be paired with energy periods, so they are excluded from net profit and shown only as mined amounts.
- **Per-GPU mining vs rental comparison** (information only): compares hourly mining net profit with rental net profit (listed price × host share − power used while rented) per GPU. A review alert is sent when:
  - renting becomes more profitable
  - the rental price exceeds the threshold set for that GPU
  - the coin price drops by more than the set percentage from the baseline
- **Vast rental price**: every 30 minutes, the public search (bundles) is queried without login for single-GPU offers of the same model.
  - By default only Vast **verified offers** are used. Unverified and deverified offers cluster at the low end and pull the median down.
    - Example: on 2026-10-18, all RTX 5090 on-demand offers gave $0.699; verified only gave $0.869.
  - Choose on-demand or interruptible (bid) offers, and optionally filter by country code.
  - Offers below 80% of the median DLPerf for the same GPU are excluded.
  - The table shows median, 25th percentile, sample count and query time. With fewer than 5 samples it shows "insufficient data" and the value is not used for comparison.
  - Comparison and review alerts use this filtered median. A manual per-GPU value takes precedence.
  - Information that needs a login, such as your own host listings and rental earnings, is planned for v0.4.0 (an official API key stored encrypted; see the [ROADMAP](docs/ROADMAP.md)).

## What it does not do

- It does not download, install, run or restart miners, and it does not build miner command lines.
- It never asks for or stores wallet seeds, passwords or tokens.
- It does not change security settings such as Windows Defender or the firewall.
- There is no remote control and no write API. The only outgoing requests are public API reads:
  - CoinGecko prices
  - Kryptex pool statistics and public wallet balance
  - Vast.ai public offers
  - GitHub Releases update checks

## Installation (Windows 10/11 x64, NVIDIA driver required)

1. Download `Crypthy-<version>-setup-x64.exe` from [Releases](https://github.com/Ruderud/crypthy/releases). This is the installer and supports auto-update. A portable `Crypthy-<version>-win-x64.zip` is also available, without auto-update.
2. Compare the hash with `SHA256SUMS.txt` from the same release.
   ```powershell
   Get-FileHash .\Crypthy-0.2.0-setup-x64.exe -Algorithm SHA256
   ```
3. Because the app is unsigned, SmartScreen may warn you. After checking the hash, click **More info → Run anyway**. Accept the MIT license in the installer.
4. Installation is per-user and needs no admin rights. The default path is `%LOCALAPPDATA%\Programs\Crypthy`.

### Ubuntu (Linux) installation (x64, NVIDIA driver + nvidia-smi required) — v0.3.0, not yet tested on real hardware

1. Download from [Releases](https://github.com/Ruderud/crypthy/releases):
   - `Crypthy-<version>-linux-x86_64.AppImage`: supports auto-update.
   - `Crypthy-<version>-linux-amd64.deb`: no auto-update.
2. Compare the hash with `SHA256SUMS.txt`.
   ```bash
   sha256sum -c SHA256SUMS.txt --ignore-missing
   ```
3. Run it.
   - AppImage:
     ```bash
     chmod +x Crypthy-*.AppImage && ./Crypthy-*.AppImage
     ```
     Ubuntu 22.04 and later may need the `libfuse2` package.
   - deb:
     ```bash
     sudo apt install ./Crypthy-*.deb
     ```
4. The tray icon uses Ubuntu's default AppIndicator. Other desktop environments may need an AppIndicator extension.
5. Turning on "start at login" in settings creates `~/.config/autostart/crypthy.desktop`.

### First-run setup

1. In the **coin hub**, pick a coin, follow the repository link of a recommended tool and install the miner **yourself**. Re-check source, hashes and dev fee in each repository. If security software blocks the miner, whether to add an exception is your decision.
2. Run the miner with its stats API enabled. For SRBMiner-MULTI add `--api-enable --api-port 21550`. If you change the port, set the same value in **Settings → miner API port**.
3. (Optional) In **First-run setup → wallet & pool**, enter your public wallet address with `.workername` appended and the pool as `host:port`. These are used only to read public pool statistics. If you have an existing miner `.bat`, **import from existing bat** reads its `--wallet` and `--pool` values.

The app UI is currently in Korean only.

### Updating from 0.1.x

- Wallet, pool, power limits, safety thresholds and profit settings are kept.
- 0.1.x miner-launch settings (miner folder, GPU selection/mapping, consent record) are no longer used and are dropped.
- GPUs that were "safety excluded" in 0.1.x become **safety holds**.
- 0.2.0 and later do not start miners. A miner started by 0.1.x keeps running, but from then on you start and restart it yourself.

## Safety watch behavior

| Condition | Action |
|---|---|
| Power > 100 W and fan 0% for 10 s or more | **Safety hold** on that GPU + stop running known miners + critical alert |
| Temperature ≥ 85°C | same |
| Mining but no temperature reading 5 times in a row (about 10 s) | same |
| Temperature ≥ 80°C | warning (re-armed below 77°C) |

- **What gets stopped**
  - Windows: miners whose executable names are verified in the catalog (`SRBMiner-MULTI.exe`, `peakminer.exe`, `forge.exe`, `arc-miner.exe`) are stopped with `taskkill`, and tasklist confirms they are gone.
  - Linux: `SRBMiner-MULTI`, `peakminer` and `forge` (names verified from the release archives) are found in `/proc`. Crypthy sends SIGTERM and, if still alive after 3 seconds, SIGKILL. To avoid touching same-named tools (for example Foundry's `forge`), only processes whose command line has pool, wallet or algorithm arguments are targeted.
  - Tools whose executable name is unverified (for example quantus-miner) cannot be stopped; you only get an alert.
- **Containers are never stopped (Linux)**: a process is not treated as a miner and is never stopped if any of the following applies. This protects container workloads such as Vast.ai customer jobs. If it cannot be determined, the process is treated as a container.
  - its cgroup path contains docker / containerd / kubepods / podman / lxc and similar
  - it is in a different PID namespace from the app, or the namespace cannot be read
  - an ancestor process is containerd-shim / dockerd / runc / conmon and similar
- **Not per GPU**: stopping works per miner, so every GPU that miner uses stops. Crypthy does not relaunch the miner with different arguments, so it cannot remove a single GPU.
- **No restart**: the app never restarts miners.
- **Hold persists**: if a miner is started again during a hold (Task Scheduler, a .bat, etc.), it is stopped again every 15 seconds. Holds survive app restarts and reboots; clear one with **clear hold** on the GPU card after fixing the cause.
- **Holds created without a miner**: a hold is also set if a dangerous condition happens with no miner running, for example overheating while gaming. This is deliberately conservative: a miner started later is stopped until the hold is cleared.
- **Monitoring paths**: if nvidia-smi fails, monitoring continues with the miner API's device values (matched by PCI bus). If tasklist fails, Crypthy tries to stop every known name and sends a critical alert if it cannot confirm. If a miner with an unknown executable name is detected only through its API, you are told it cannot be stopped.
- **Process name match**: another program with exactly the same executable name can also be stopped, for example a different app named `forge.exe`.
- **Turning off auto-stop**: if **Settings → stop running miners on dangerous conditions** is off, nothing is stopped and only critical alerts repeat.
- **Stop failures**: a miner running with admin rights cannot be stopped by the non-admin app. You get a critical alert; end it in Task Manager.
- **Limitation**: nvidia-smi `fan.speed` is the target speed (%) requested by the driver, not actual RPM. A physically blocked fan may not show 0%, so the temperature rules are the final safety net.

## Power limits — Linux (one-time admin authentication)

1. Enter watts in the GPU settings table, then click **install power-limit service (one-time admin authentication)** and approve the `pkexec` prompt. The bundled `resources/linux/install-power-service.sh` runs as root and:
   - copies `/usr/local/lib/crypthy/apply_power_limits.py` owned by root with mode 0755
   - creates the systemd service `crypthy-power-limit.service` (oneshot), applied at boot, with protections such as `ProtectSystem=strict`
   - creates the polkit rule `/etc/polkit-1/rules.d/50-crypthy-power-limit.rules`, which allows **only this user** to **start this service** and nothing else
2. After changing values, click **apply power limits now**. The app writes only PCI bus ids and watts to `~/.config/Crypthy/power-limits.json` and runs `systemctl start crypthy-power-limit.service`.
   - On older systems without polkit JS rules (for example polkit 0.105 on Ubuntu 22.04), a `pkexec` prompt appears every time you apply.
3. Check the result in `/var/lib/crypthy/power-limit.log`.

The security principles are the same as on Windows:
- The script that runs is owned by root; the user-writable JSON is read only as data.
- Only PCI bus id format and integers from 100 to 1000 are accepted, up to 16 entries.
- Only nvidia-smi at a fixed path is executed, without a shell.
- The content of a non-JSON file is never written to the log.

Uninstall:

```bash
sudo systemctl disable --now crypthy-power-limit.service
sudo rm -f /etc/systemd/system/crypthy-power-limit.service /etc/polkit-1/rules.d/50-crypthy-power-limit.rules
sudo rm -rf /usr/local/lib/crypthy /var/lib/crypthy
sudo systemctl daemon-reload
```

## Power limits — Windows (one UAC prompt)

1. Enter watts per GPU in the **GPU settings · power limits** table. Values must be within the range reported by nvidia-smi; leave a GPU empty to leave it untouched.
2. Click **register power-limit scheduled task (one UAC prompt)** and approve UAC. `resources\ps\register-power-task.ps1`, running elevated:
   - creates the folder `C:\ProgramData\Crypthy\` from scratch
     - if it already exists it is removed and recreated; a junction/symlink is not followed and the script aborts
     - it is created atomically with its permissions: owner Administrators, inheritance disabled, Users read/execute only
   - copies the apply script into that folder
   - registers the scheduled task `Crypthy-PowerLimit`, running as the current user with highest privileges 30 seconds after logon
3. After changing values, click **apply power limits now**. The app writes only PCI bus ids and watts to `%APPDATA%\Crypthy\power-limits.json` and runs the task with `schtasks /run`.
4. Check the result in the log under the table (`C:\ProgramData\Crypthy\power-limit.log`).

Security notes:
- The scheduled task reads the JSON only as data. Only PCI bus id format and integers from 100 to 1000 are passed to `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`.
- The original registration script lives in the install folder (user-writable). Register only from an installation you trust.

Uninstall (admin PowerShell):

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

## Auto-update

- **When it checks**: works for the Windows installer (NSIS) and the Linux AppImage; zip and deb are updated manually.
  - It checks once a few seconds after the window opens, then every hour.
  - The interval can be changed between 30 minutes and 24 hours in **Settings → update check interval**.
  - You can also check right away with **check for updates** in the header or the tray menu.
- **New version found**: a banner at the top of the app and an OS notification appear together. Even when the app is only in the tray you get the OS notification, and clicking it opens the window. The banner offers:
  - the new version number and a release-notes summary, with **download / later**
  - **download** downloads in the background and shows progress
  - once downloaded you are asked again with **restart now to install / later**
- **Later**: the same notice for the same version is not shown again until the next scheduled check. A manual check shows it again immediately.
- **Install**: only when you click **restart now to install**. There is no forced restart and no install on quit.
  - Crypthy does not manage miners, so mining continues through the restart.
  - Only the safety watch pauses for the few to tens of seconds the restart takes.
- **Verification**: the download is checked against the sha512 in `latest.yml` (Windows) or `latest-linux.yml` (Linux).
  - Builds are unsigned, so signature verification (`verifyUpdateCodeSignature`) is off.
  - This verification therefore only guarantees that the file matches what was uploaded to GitHub Releases.
- **Safe on failure**: a failed update only leaves an alert and does not affect the safety watch.
- **Release notes**: the Release workflow writes them from commit titles since the previous tag.
- **Try it in mock mode**: run with `CRYPTHY_MOCK=1 CRYPTHY_MOCK_UPDATE=1` to walk through the update flow with a fake update.

## Local status API

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

- **Access**: bound to `127.0.0.1` only.
  - If the Host header is not `127.0.0.1:47321` or `localhost:47321`, it returns 403 (DNS rebinding protection).
  - Methods other than GET return 405; other paths return 404.
- **Response size limits**: 8 gpus, 20 alerts (newest first), 120 characters per string. Wallet and settings are never included.
- **Field values**
  - `mode`: `external` (a miner is running; Crypthy never runs miners, so it is always this value) | `null` (no miner)
  - `hashrate`: H/s
  - alert `gpu`: PCI bus id
- **Alert codes**
  - safety: `fan_stopped`, `temp_stop`, `temp_warn`, `telemetry_lost`, `miner_killed`, `miner_killed_again`, `kill_failed`, `safety_hold_running`, `hold_cleared`
  - review: `review_rental_price`, `review_rental_better`, `review_prl`
  - update: `update_available`, `update_ready`, `update_error`
  - other: `status_api`

## File locations

| File | Path |
|---|---|
| Settings | Windows `%APPDATA%\Crypthy\settings.json` · Linux `~/.config/Crypthy/settings.json` |
| Safety holds | `%APPDATA%\Crypthy\runtime.json` |
| Daily/monthly ledger | `%APPDATA%\Crypthy\ledger.json` |
| Chart history (last 3 days) | `%APPDATA%\Crypthy\history.json` |
| Power-limit values | `%APPDATA%\Crypthy\power-limits.json` |
| Power-limit script and log | `C:\ProgramData\Crypthy\` |

## Development

```bash
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run check:readme # README.md / README.ko.md / README.zh-CN.md structure in sync
npm run start:mock   # UI with mock hardware (works on macOS/Linux)
npm run dist:win     # Windows x64 NSIS + zip + latest.yml + SHA256SUMS (no upload)
npm run dist:linux   # Linux x64 AppImage + deb + latest-linux.yml (builds on macOS too)
```

Mock mode options:
- `CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>`: that GPU's fan drops to 0% after 30 seconds.
- `CRYPTHY_MOCK_KILLFAIL=1`: simulates a failure to stop the miner.
- `CRYPTHY_MOCK_IDLE=1`: starts with no miner running.
- `CRYPTHY_MOCK_UPDATE=1`: walks through the update flow with a fake update (v0.9.9).

When editing the catalog:
- Record the source URL and check date in `catalog/catalog.json`.
- Tests enforce that:
  - a verified dev fee has a source
  - repository links are GitHub repositories only
  - unverified tools have no link

Add new miner stats APIs as adapters in `MINER_APIS` in `src/main/minerApi.ts`.

Keep `README.md`, `README.ko.md` and `README.zh-CN.md` in sync; `npm run check:readme` (also run in CI) compares their structure.

### Releases (GitHub Actions)

- `CI`: on every push to main and every PR, runs typecheck and unit tests on an ubuntu/windows matrix.
- `Release`: pushing a `v*` tag runs the following on windows-latest. Only `GITHUB_TOKEN` is used.
  1. Check that the tag matches the `package.json` version.
  2. Run the tests.
  3. Build.
  4. The Windows job uploads the installer, `.blockmap`, `latest.yml` and zip.
  5. The Linux job then uploads the AppImage, `latest-linux.yml` and deb.
  6. The last job uploads `SHA256SUMS.txt` covering every binary.

## Third-party notices

- **TradingView Lightweight Charts™**: 5.2.1, Apache-2.0. Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
  - As the license requires, the TradingView logo link in the charts (`attributionLogo`) is kept.
  - The attribution is shown at the bottom of the app.
  - LICENSE and NOTICE ship in the package under `resources/app.asar/dist/renderer/vendor/`.
  - Original text: [`resources/third-party/lightweight-charts-NOTICE.txt`](resources/third-party/lightweight-charts-NOTICE.txt)
- Other runtime dependencies: Electron (MIT), electron-updater (MIT)

## License

[MIT](LICENSE) © 2026 Ruderud

Mining tools (SRBMiner-MULTI and others) are not included in this repository and follow their own licenses and dev fee policies.
