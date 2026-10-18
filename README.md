**English** | [한국어](README.ko.md) | [简体中文](README.zh-CN.md)

<p align="center"><img src="resources/icon.png" width="96" alt="Crypthy" /></p>

# Crypthy

Coin-mining hub, GPU/PC manager and mining profit tracker for **Windows and Ubuntu (Linux)** PCs with NVIDIA GPUs.

[![CI](https://github.com/Ruderud/crypthy/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruderud/crypthy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Ruderud/crypthy)](https://github.com/Ruderud/crypthy/releases)
[![License: MIT](https://img.shields.io/github/license/Ruderud/crypthy)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-informational)](#download-and-install)

![Dashboard (dark theme, mock data)](docs/screenshots/dashboard-dark.png)

> **Important**
> - **Crypthy does not download or install miners.** It recommends compatible mining tools with links to their official repositories; you install and configure the miner yourself. It can then start and stop the miner you configured (a scheduled task, a systemd user unit or an executable) from the app and the tray.
> - **No default wallet and no dev fee.** The wallet address is only used to read public pool statistics.
> - **On danger it only stops.** On a stopped fan or overheating it stops known running miners and never restarts them; this can be turned off.
> - **Builds are not code-signed.** Verify downloads with `SHA256SUMS.txt` from each release.
> - Mining costs electricity, stresses GPUs and can lose money. The safety watch is an aid, not a guarantee.
>
> Details: [Safety and privacy](#safety-and-privacy).

## Features

### Coin hub

- Pick a coin to see its algorithm, the GPU vendors detected on this PC (NVIDIA, AMD, Intel) and a ranked list of compatible mining tools with official repository links, supported GPUs, dev fee and notes.
- The list comes from the curated [`catalog/catalog.json`](catalog/catalog.json). Every value records its source URL and check date; unconfirmed values are shown as **unverified**, and tools without a confirmed official repository are not linked.
- Ranking: compatible with this PC's GPUs → dev fee verified → sources disagree → unverified → lower verified fee first.

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

- **GPU dashboard**: `nvidia-smi` every 2 seconds: temperature, fan, power/limit, utilization. GPUs are identified by PCI bus id.
- **Safety watch**: stops known miners on a stopped fan, overheating or lost temperature readings. See [Safety watch](#safety-watch).
- **Mining on/off**: start and stop the miner you configured from the miner card and the tray. See [Mining on/off](#mining-on-off).
- **Headless host and remote screen**: run Crypthy as a service on a PC without a screen and view or control it from another Crypthy over Tailscale. See [Headless host](#headless).
- **Power limits**: watts per GPU, re-applied automatically after a one-time admin approval (Windows scheduled task / Linux systemd service). The app itself runs as a normal user.
- **Tray app** with optional start at login, a read-only **local status API**, and **auto-update** from GitHub Releases.

### Charts

Drawn with [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (Apache-2.0):
- per-GPU hashrate, temperature and power (1-minute averages, last 3 days, up to 4,320 points per GPU and 16 GPUs)
- 30-day coin price (CoinGecko, USD)
- daily mined amount (bars) and net profit in KRW (line), using that day's closing price or the current price, minus electricity

### Output and profit

- **Live estimate (KRW/h)**: measured hashrate × expected output from pool statistics × price − measured GPU power cost. Hashrate comes from the miner's stats API (SRBMiner-MULTI with `--api-enable --api-port 21550`); pool statistics come from Kryptex and are read even without a wallet. Without a Kryptex pool, today/month estimates accumulate output and energy over the same time.
- **Today / this month profit** (with a Kryptex pool): (pool-confirmed output + backfilled output + live estimate not yet reflected by the pool) × price − power cost of the same period. Each pool increase is split across days by time since the previous increase, so an increase that spans midnight is shared by both days. The live estimate is replaced by the confirmed amount once the pool shows it. The breakdown is shown under the number and in its tooltip. **Lifetime output** is the pool's public cumulative total (unpaid balance + payouts) and includes mining before the app was started.
- **Price**: CoinGecko, converted with the exchange rate in settings. On failure the last good price is used with its time (marked stale after 30 minutes); with no price at all, net profit is not calculated and "no price" is shown.
- **Mining vs rental** (information only): per-GPU mining net vs rental net (listed price × host share − power while rented), with review alerts when renting wins, a per-GPU price threshold is exceeded, or the coin price drops by a set percentage.
- **Vast rental price**: public search (no login) every 30 minutes for single-GPU offers of the same model. By default only **verified** offers are used (unverified/deverified offers cluster at the low end: on 2026-10-18 all RTX 5090 on-demand offers gave $0.699, verified only $0.869). On-demand or interruptible, optional country filter, offers below 80% of the median DLPerf dropped. Shows median, 25th percentile, sample count and time; fewer than 5 samples shows "insufficient data". A manual per-GPU value takes precedence.

### Cumulative PnL

- Every pool increase, payout, price and 10-minute energy interval is appended to a local event log (`pnl/events.jsonl`, one JSON line per event; corrupt lines are skipped; rotated once at 5 MB). Daily totals are kept in `pnl/daily.json` without a time limit and are the basis for the numbers below.
- **Definitions**: revenue = mined amount × price at the time it was mined; energy cost = measured GPU energy × electricity price at that time; realized = manual sales − fees; unrealized = holdings (mined − sold) × current price; **total PnL = realized + unrealized − energy cost**.
- Today / this month / 7 days / 30 days / all, plus a daily net bar chart with a cumulative PnL line. Coins mined while no price was available are valued at the next price and marked estimated; with no current price, unrealized and total PnL show "no price", never 0.
- **Backfill**: output mined before tracking started (the pool total when tracking began) is applied automatically once hashrate, pool statistics and GPU power are known. The start time is estimated as pool total ÷ current expected rate (never later than the earliest payout) and energy from current GPU power. You can correct the start time and wattage and recalculate; the previous backfill is replaced, not added. Backfilled days are marked estimated.
- **Manual sales** (optional): quantity, proceeds, fee, venue and note, stored locally only. Without sales everything is unrealized.
- **CSV export** of daily totals and events, and a button to open the log folder.

### Theme

Dark exchange-style dashboard by default (yellow accent, tabular numbers, green up / red down) with light and system themes. No exchange logos, names or icons are used.

## Screenshots

![Dashboard (dark theme, mock data)](docs/screenshots/dashboard-dark.png)

<details><summary>Light theme</summary>

![Dashboard (light theme, mock data)](docs/screenshots/dashboard-light.png)

</details>

Screenshots use synthetic data from mock mode (`npm run start:mock`).

<a id="download-and-install"></a>

## Download and install

Download from [Releases](https://github.com/Ruderud/crypthy/releases). An NVIDIA driver with `nvidia-smi` is required.

| Platform | File | Auto-update |
|---|---|---|
| Windows 10/11 x64 | `Crypthy-<version>-setup-x64.exe` (installer) | yes |
| Windows 10/11 x64 | `Crypthy-<version>-win-x64.zip` (portable) | no |
| Linux x64 | `Crypthy-<version>-linux-x86_64.AppImage` | yes |
| Linux x64 (Debian/Ubuntu) | `Crypthy-<version>-linux-amd64.deb` | no |

### Verify the download

Builds are not code-signed. Compare the hash with `SHA256SUMS.txt` from the same release.

```powershell
Get-FileHash .\Crypthy-0.2.0-setup-x64.exe -Algorithm SHA256
```

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

### Windows

1. Run the installer. SmartScreen may warn because the app is unsigned; after checking the hash, click **More info → Run anyway** and accept the MIT license.
2. Installation is per-user (no admin rights). Default path: `%LOCALAPPDATA%\Programs\Crypthy`.

### Linux (Ubuntu) — v0.3.0, not yet tested on real hardware

- AppImage (Ubuntu 22.04+ may need `libfuse2`):
  ```bash
  chmod +x Crypthy-*.AppImage && ./Crypthy-*.AppImage
  ```
- deb:
  ```bash
  sudo apt install ./Crypthy-*.deb
  ```
- The tray icon uses Ubuntu's AppIndicator; other desktops may need an AppIndicator extension. "Start at login" creates `~/.config/autostart/crypthy.desktop`.

<a id="headless"></a>

### Headless host and remote screen (v0.4.0, not yet tested on real hardware)

For a PC without a screen, such as Ubuntu Server used as a Vast.ai host. Crypthy runs there as a systemd service (`crypthy-headless`: monitor, safety stop, profit tracking, no window), and another Crypthy connects over a private network such as [Tailscale](https://tailscale.com/) and shows the same dashboard.

1. On the host (Node.js 18+, `sudo apt install nodejs`), download `crypthy-headless-<version>.tar.gz` from Releases:
```bash
tar xzf crypthy-headless-*.tar.gz && cd crypthy-headless-*/
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)"
sudo -u "$USER" crypthy-headless --print-tokens
```
2. In Crypthy on the other PC: **Settings → remote host**, enter the host's address (`100.x.y.z:47321`) and the read token. The header shows **remote** while connected; **back to this PC** disconnects.
3. To start and stop mining, change settings or clear holds from the other PC, install with writes enabled and also enter the write token:
```bash
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --enable-write --accept-risk
```

- The remote API listens on 127.0.0.1 unless `--bind` names one specific IP; it never listens on all addresses (0.0.0.0). Reading needs the read token; writing needs `--enable-write` and a separate write token. Tokens are random, stored owner-only in `/var/lib/crypthy-headless`, and never written to logs.
- Responses never include the wallet address (only `prl1qe…0000.rig1`), also not inside miner arguments.
- The miner on/off method (executable, arguments, task, unit), safety settings and start at login can only be changed on the host: edit `/var/lib/crypthy-headless/settings.json` and run `sudo systemctl restart crypthy-headless`. A write token alone cannot make the host run another program or turn off the safety stop.
- On a headless host the first start needs `--accept-risk` or the consent dialog on the connected PC. After a danger stop it still never restarts the miner.
- `--power-limits` also installs the GPU power-limit service with the same `sudo` (no pkexec). No automatic updates: run the new `install.sh` again (data is kept).
- Containers (Docker, containerd, Vast.ai `kaalia`) are never stopped.
- macOS has no release build yet; run from source:
```bash
git clone https://github.com/Ruderud/crypthy && cd crypthy
npm ci && npm run build && npx electron .
```

## Quick start

1. In the **coin hub**, pick a coin, open a recommended tool's repository and install the miner **yourself**. Re-check source, hashes and dev fee there. If security software blocks the miner, whether to allow it is your decision.
2. Run the miner with its stats API enabled. For SRBMiner-MULTI add `--api-enable --api-port 21550`; if you use another port, set the same value in **Settings → miner API port**.
3. (Optional) In **First-run setup → wallet & pool**, enter your public wallet address with `.workername` and the pool as `host:port` to see pool-confirmed output. **Import from existing bat** reads `--wallet` and `--pool` from a miner `.bat`.

The app UI is currently in Korean only.

### Updating from 0.1.x

- Wallet, pool, power limits, safety thresholds and profit settings are kept; 0.1.x miner-launch settings (miner folder, GPU selection/mapping, consent record) are dropped.
- GPUs that were "safety excluded" become **safety holds**.
- 0.2.0 to 0.3.6 never start miners; from 0.3.7 you can start and stop a miner you configured yourself (see [Mining on/off](#mining-on-off)). A miner started by 0.1.x keeps running.
- When updating from 0.3.1 or earlier, the profit ledger is converted: the pool baseline is kept and old daily values are shown as mined amounts only (excluded from net profit).

## Configuration

### Settings

| Setting | Default | Notes |
|---|---|---|
| Coin | Pearl | Catalog coin for the hub, price and pool statistics |
| Wallet / pool | empty | Public address `.worker` and `host:port`; only for public pool statistics |
| Miner stats API / port | SRBMiner-MULTI / 21550 | `none` disables it |
| Mining on/off | not used | Scheduled task (Windows), systemd user unit (Linux) or executable + arguments; confirm before stopping (on) |
| Shared ledger folder | empty (this PC only) | Dual boot: folder both OSes can reach; see [Shared ledger](#shared-ledger) |
| Stop miners on dangerous conditions | on | Off = alerts only |
| Start at login | off | Windows login item / Linux XDG autostart |
| Show window at login | off (tray only) | On: the window opens at login |
| Start mining when Crypthy starts | off | 30 s after start; needs consent; skipped on a safety hold, a recent danger stop or a miner already running |
| Update check interval | 60 min | 30–1440 minutes |
| Fan-stop power / time | 100 W / 10 s | Safety watch |
| Temperature warning / stop | 80°C / 85°C | Safety watch |
| Electricity price / exchange rate | 350 KRW/kWh / 1340 KRW/$ | Profit |
| Rental host share / power while rented | 0.75 / 250 W | Mining vs rental |
| Price drop alert / baseline price | 30% / first price seen | Review alert |
| Vast verified only / offer type / regions | on / on-demand / all | Rental price filter |

<a id="mining-on-off"></a>

### Mining on/off

Crypthy starts and stops only a miner you set up yourself; it never downloads or installs one. Choose a method in **Settings → mining on/off**:

| Method | Start | Stop |
|---|---|---|
| Windows scheduled task | `schtasks /Run /TN <name>` | `schtasks /End /TN <name>`, then stop the miner process |
| Linux systemd user unit | `systemctl --user start -- <unit>` | `systemctl --user stop -- <unit>`, then stop the miner process |
| Executable | runs the `.exe` (Windows) or binary with your arguments, without a shell, detached from the app | stops the miner process |

- Use the **start / stop** buttons on the miner card or the tray menu; only the one that applies is enabled.
- The first start asks you to accept a risk and cost notice. Stopping asks once for confirmation (can be turned off).
- If a miner is already running (for example started outside the app), **start** is disabled and the card shows "started outside the app"; a second miner is never launched. **Stop** still works.
- For a scheduled task, **import from scheduled task** reads the task's executable and arguments; the executable name is also added to the processes the app watches and stops.
- Arguments are split on spaces (use "double quotes" for spaces) and passed as a list, so shell characters such as `&` or `|` have no effect. On Windows only `.exe` files can be run directly; use a scheduled task for a `.bat`.
- The app runs as a normal user. A miner started as administrator cannot be stopped by it; you are told to stop it in Task Manager.
- After a danger stop the app does not start the miner again by itself; with a scheduled task or unit it also ends the task or unit, so Task Scheduler or systemd cannot restart the miner. The executable must be the miner itself, not `cmd` or `powershell`. See [Safety watch](#safety-watch).
- **Start mining when Crypthy starts** (off by default): 30 seconds after Crypthy starts it starts the configured miner once. It needs the risk and cost notice (asked when you turn it on) and is skipped on a safety hold, a danger stop in the last 6 hours, or when a miner is already running (for example started by a scheduled task); the reason appears in the alerts. It never restarts a miner after a danger stop.
- With **executable** the miner starts without a console window on Windows (**hide miner console window**, on by default). Its output goes to `logs/miner.log`; **view miner window** on the miner card shows it in the app only when you want. A **scheduled task** is launched by Task Scheduler, which always opens the miner's console window, so prefer **executable**.
- **Browse…** buttons pick the miner executable and the shared ledger folder with the file dialog (typing the path still works).
- To let Crypthy open at login and start mining quietly instead of a scheduled task that opens a console window:
  1. Settings → mining on/off: **scheduled task**, the task name (e.g. `PearlMiner`), then **switch to executable**. It reads the task's executable and arguments (also through a `conhost --headless` wrapper) and changes the method to **executable** with the console window hidden.
  2. Turn on **start mining when Crypthy starts**, **start at login** and **show window at login**, and save.
  3. If the old task is still enabled, the settings show **disable scheduled task** (asks first; the task is only disabled, not deleted). If that needs administrator rights, run in an administrator command prompt:
```bat
schtasks /Change /TN PearlMiner /DISABLE
```

### Power limits — Windows (one UAC prompt)

1. Enter watts per GPU in the **GPU settings · power limits** table (within the range reported by nvidia-smi; empty = untouched).
2. Click **register power-limit scheduled task (one UAC prompt)** and approve. `resources\ps\register-power-task.ps1`, running elevated:
   - recreates `C:\ProgramData\Crypthy\` atomically with protected permissions (owner Administrators, inheritance off, Users read/execute); an existing junction/symlink aborts the script
   - copies the apply script there and registers the task `Crypthy-PowerLimit` (current user, highest privileges, 30 seconds after logon)
3. After changing values, click **apply power limits now**. The app writes only PCI bus ids and watts to `%APPDATA%\Crypthy\power-limits.json` and runs `schtasks /run`. The log is `C:\ProgramData\Crypthy\power-limit.log`.

The task reads the JSON only as data and passes only PCI bus ids and integers 100–1000 to `C:\Windows\System32\nvidia-smi.exe -i <bus id> -pl <W>`. Register only from an installation you trust (the original script lives in the user-writable install folder).

```powershell
schtasks /delete /tn Crypthy-PowerLimit /f
Remove-Item -Recurse C:\ProgramData\Crypthy
```

### Power limits — Linux (one admin authentication)

1. Enter watts, click **install power-limit service (one-time admin authentication)** and approve `pkexec`. The bundled `resources/linux/install-power-service.sh` (root):
   - installs `/usr/local/lib/crypthy/apply_power_limits.py` (root-owned, 0755)
   - creates the oneshot unit `crypthy-power-limit.service` (applied at boot, `ProtectSystem=strict` and other protections)
   - creates `/etc/polkit-1/rules.d/50-crypthy-power-limit.rules`, allowing **only this user** to **start only this service**
2. **Apply power limits now** writes `~/.config/Crypthy/power-limits.json` (PCI bus ids and watts only) and runs `systemctl start crypthy-power-limit.service`. Without polkit JS rules (for example polkit 0.105 on Ubuntu 22.04) a `pkexec` prompt appears each time.
3. The log is `/var/lib/crypthy/power-limit.log`. Input rules match Windows: data only, PCI bus id format, integers 100–1000, at most 16 entries, fixed nvidia-smi path, no shell, non-JSON content never logged.

```bash
sudo systemctl disable --now crypthy-power-limit.service
sudo rm -f /etc/systemd/system/crypthy-power-limit.service /etc/polkit-1/rules.d/50-crypthy-power-limit.rules
sudo rm -rf /usr/local/lib/crypthy /var/lib/crypthy
sudo systemctl daemon-reload
```

### Auto-update

- Windows installer and Linux AppImage only. Checks a few seconds after the window opens and then every hour (30 minutes–24 hours in settings); **check for updates** is in the header and the tray menu.
- A new version shows a banner pinned under the header with release notes and **download / later**; after downloading, **restart now to install / later**. The banner is the only place with these choices. When only the tray is running (window hidden or minimized), one OS notification is shown as well; clicking it opens the window, scrolls to the top and highlights the banner. A manual **check for updates** shows the banner only.
- **Later** hides the same notice until the next scheduled check; a manual check shows it again.
- Install happens only when you click. Miners run separately from the app, so mining continues through the restart; only the safety watch pauses briefly.
- Downloads are checked against the sha512 in `latest.yml` / `latest-linux.yml`. Builds are unsigned, so signature verification (`verifyUpdateCodeSignature`) is off; this only proves the file matches the one on GitHub Releases.
- A failed update leaves an alert and does not affect the safety watch. If installing the update cannot replace the app files, the installer does not start a half-installed app; it says so and opens the release page. To recover, download `Crypthy-<version>-setup-x64.exe` from [Releases](https://github.com/Ruderud/crypthy/releases) and run it; settings and data in `%APPDATA%\Crypthy` are kept. The update steps are written to `%APPDATA%\Crypthy\logs\main.log`. Try the flow with `CRYPTHY_MOCK=1 CRYPTHY_MOCK_UPDATE=1`.

### Local status API

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

- Bound to `127.0.0.1` only. A Host header other than `127.0.0.1:47321` / `localhost:47321` gets 403 (DNS rebinding protection); non-GET gets 405, other paths 404.
- At most 8 gpus, 20 alerts (newest first), 120 characters per string. No wallet or settings.
- `mode`: `external` (a miner started outside the app is running), `app` (started with the app's **start**) or `null`. `hashrate` is H/s. Alert `gpu` is a PCI bus id.
- Alert codes — safety: `fan_stopped`, `temp_stop`, `temp_warn`, `telemetry_lost`, `miner_killed`, `miner_killed_again`, `kill_failed`, `safety_hold_running`, `hold_cleared`; review: `review_rental_price`, `review_rental_better`, `review_prl`; update: `update_available`, `update_ready`, `update_error`; other: `status_api`.
- The response also includes a `pnl` object with rounded totals only (`mined_coin`, `holdings_coin`, `revenue_krw`, `energy_cost_krw`, `realized_krw`, `unrealized_krw`, `total_pnl_krw`, `estimated`); the raw log is never exposed.
- A headless host serves the same port with more endpoints (`/v1/state`, `/v1/charts`, writes) behind tokens; see [Headless host](#headless).

<a id="shared-ledger"></a>

### Shared ledger (dual boot)

When one PC boots both Windows (Crypthy) and Linux (`crypthy-headless`), each keeps its own data, so the PnL would split in two. Point both at one folder both OSes can read and write, such as a small FAT32/exFAT partition, and they share one PnL:

- Windows: **Settings → shared ledger folder**, e.g. `U:\`.
- Linux headless: `--shared-ledger <mount path>` (or `sharedLedgerDir` in `settings.json`):
```bash
sudo ./install.sh --user "$USER" --bind "$(tailscale ip -4)" --shared-ledger /mnt/crypthy
```

- Inside it Crypthy uses `crypthy/`. Each instance appends only to its own `pnl/events-<instance id>.jsonl` and only reads the others. The PnL is recomputed from all of them, so totals match a single ledger.
- The pool baseline (last pool total, payouts seen) is shared in `pool-state.json`: the OS that starts next continues from where the other stopped, so pool increases and payouts are counted once. Order uses a generation number, not the clock (the two OSes may read the hardware clock differently).
- Coin, wallet, pool and profit settings are shared (`shared-settings.json`); miner on/off, remote API and power limits stay per OS.
- The first time, the existing local ledger is copied into this instance's file. Events copied between the two data folders before are counted once.
- If the folder is missing (not mounted), Crypthy keeps recording energy and sales locally and copies them when the folder is back; pool increases are not recorded meanwhile (they would be counted twice) and resume from the shared baseline. Once set up, a folder without `crypthy/` counts as not mounted. On Linux the service waits for the mount (`RequiresMountsFor`). Energy records of two instances that overlap in time are flagged.
- The two OSes must not run at the same time on the same pool data (a dual boot never does).

### File locations

| File | Path |
|---|---|
| Settings | Windows `%APPDATA%\Crypthy\settings.json` · Linux `~/.config/Crypthy/settings.json` |
| Safety holds | `%APPDATA%\Crypthy\runtime.json` |
| Daily/monthly ledger | `%APPDATA%\Crypthy\ledger.json` |
| Chart history (last 3 days) | `%APPDATA%\Crypthy\history.json` |
| Power-limit values | `%APPDATA%\Crypthy\power-limits.json` |
| Power-limit script and log | `C:\ProgramData\Crypthy\` |
| PnL event log (rotated at 5 MB) | `%APPDATA%\Crypthy\pnl\events.jsonl` |
| PnL daily totals (no time limit) | `%APPDATA%\Crypthy\pnl\daily.json` |
| App log (update and quit steps, rotated at 1 MB) | `%APPDATA%\Crypthy\logs\main.log` |
| Headless host data and tokens | `/var/lib/crypthy-headless/` (owner only) |
| Shared ledger | `<folder>\crypthy\` (events per instance, pool baseline, shared settings) |

<a id="safety-and-privacy"></a>

## Safety and privacy

<a id="safety-watch"></a>

### Safety watch

| Condition | Action |
|---|---|
| Power > 100 W and fan 0% for 10 s or more | **Safety hold** on that GPU + stop running known miners + critical alert |
| Temperature ≥ 85°C | same |
| Mining but no temperature reading 5 times in a row (about 10 s) | same |
| Temperature ≥ 80°C | warning (re-armed below 77°C) |

- **What gets stopped**
  - Windows: catalog-verified executables (`SRBMiner-MULTI.exe`, `peakminer.exe`, `forge.exe`, `arc-miner.exe`) via `taskkill`, confirmed with tasklist.
  - Linux: `SRBMiner-MULTI`, `peakminer`, `forge` (verified from release archives) found in `/proc`; SIGTERM, then SIGKILL after 3 seconds. Only processes whose command line has pool, wallet or algorithm arguments are targeted, so same-named tools (for example Foundry's `forge`) are left alone.
  - Tools with an unverified executable name (for example quantus-miner) cannot be stopped; you only get an alert.
- **Containers are never stopped (Linux)** — protects workloads such as Vast.ai customer jobs. A process is skipped if any of these apply, and also when it cannot be determined:
  - its cgroup path contains docker / containerd / kubepods / podman / lxc and similar
  - it is in a different PID namespace from the app, or the namespace cannot be read
  - an ancestor process is containerd-shim / dockerd / runc / conmon and similar
- Stopping is per miner, not per GPU. After a danger stop the app never starts the miner again; **start** stays disabled until you clear the hold, and then shows the cause once more before starting.
- **Holds persist** across app restarts and reboots. A miner started again during a hold is stopped again every 15 seconds; clear the hold with **clear hold** on the GPU card after fixing the cause. Holds are also set when no miner is running (for example overheating while gaming).
- If nvidia-smi fails, monitoring continues with the miner API's device values (matched by PCI bus). If tasklist fails, every known name is stopped and a critical alert is sent if this cannot be confirmed. A miner detected only through its API with an unknown executable name is reported as not stoppable.
- Another program with exactly the same executable name can also be stopped (for example a different `forge.exe`).
- With **Settings → stop running miners on dangerous conditions** off, only critical alerts repeat. A miner running with admin rights cannot be stopped by the non-admin app; end it in Task Manager.
- nvidia-smi `fan.speed` is the requested speed, not measured RPM. A physically blocked fan may not show 0%, so the temperature rules are the final safety net.

### Privacy and network requests

- No telemetry, no account, no remote control and no write API.
- It never asks for or stores wallet seeds, passwords or tokens, and never changes security settings such as Windows Defender or the firewall.
- It does not download or install miners and does not build miner command lines. It only starts or stops the miner you configured, when you click.
- Outgoing requests are public reads only:
  - CoinGecko prices
  - Kryptex pool statistics and public wallet balance
  - Vast.ai public offers
  - GitHub Releases update checks

### Unsigned builds

Builds are not code-signed, so Windows SmartScreen may warn. Every release includes `SHA256SUMS.txt`, and auto-update checks the sha512 in the release metadata. Report security issues as described in [SECURITY.md](SECURITY.md).

## FAQ

**Does Crypthy mine or take a fee?**
No. It never downloads miners and has no dev fee. Miners you install may charge their own dev fee, shown in the coin hub.

**Why are today and this month marked "estimated"?**
They include backfilled output (estimated start time and power) and the live estimate that the pool has not reflected yet. Both are replaced or corrected as the pool confirms output or you recalculate the backfill.

**Does a safety stop affect only the hot GPU?**
No. Crypthy stops the whole miner process, so every GPU it uses stops, and it does not restart it.

**Will it stop my Vast.ai rentals on Linux?**
No. Processes in containers (docker/containerd/podman/lxc, other PID namespaces or under container runtimes) are never treated as miners.

**Why does my antivirus flag the miner?**
Mining software is often flagged. Crypthy does not change security settings; decide yourself after checking the source and hashes.

**Why is the app in Korean?**
The UI is Korean-only for now. Translations are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) and the [CHANGELOG](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

```bash
npm install
npm test             # unit tests (vitest)
npm run typecheck
npm run check:readme # README.md / README.ko.md / README.zh-CN.md structure in sync
npm run start:mock   # UI with mock hardware (works on macOS/Linux)
npm run dist:win     # Windows x64 NSIS + zip + latest.yml + SHA256SUMS (no upload)
npm run dist:linux   # Linux x64 AppImage + deb + latest-linux.yml (builds on macOS too)
```

- Mock options: `CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>` (fan drops to 0% after 30 s), `CRYPTHY_MOCK_KILLFAIL=1`, `CRYPTHY_MOCK_IDLE=1`, `CRYPTHY_MOCK_UPDATE=1` (fake update v0.9.9).
- Catalog edits need a source URL and check date; tests require a source for verified fees, GitHub-only repository links and no link for unverified tools.
- New miner stats APIs are adapters in `MINER_APIS` in `src/main/minerApi.ts`.
- Keep `README.md`, `README.ko.md` and `README.zh-CN.md` in sync; `npm run check:readme` runs in CI.
- Releases: pushing a `v*` tag builds Windows and Linux, uploads installers, `latest.yml`, `latest-linux.yml` and `SHA256SUMS.txt`, and uses the matching [CHANGELOG](CHANGELOG.md) section as release notes. Only `GITHUB_TOKEN` is used.

## License

[MIT](LICENSE) © 2026 Ruderud

Mining tools (SRBMiner-MULTI and others) are not included in this repository and follow their own licenses and dev fee policies.

## Acknowledgements

- [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) 5.2.1, Apache-2.0, Copyright (c) 2025 TradingView, Inc. The chart attribution logo link (`attributionLogo`) is kept and the attribution is shown at the bottom of the app. LICENSE and NOTICE ship under `resources/app.asar/dist/renderer/vendor/`; original text: [`resources/third-party/lightweight-charts-NOTICE.txt`](resources/third-party/lightweight-charts-NOTICE.txt).
- [Electron](https://www.electronjs.org/) (MIT), [electron-builder / electron-updater](https://www.electron.build/) (MIT).
- Public data: [CoinGecko](https://www.coingecko.com/), [Kryptex pool](https://pool.kryptex.com/), [Vast.ai](https://vast.ai/).
