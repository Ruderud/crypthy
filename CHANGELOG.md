# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, minor versions may contain breaking changes.

Release notes on GitHub are taken from the matching section of this file.

## [Unreleased]

## [0.6.1] - 2026-10-28

Power limits only. `settings.json` is read as before. The scheduled task script in `C:\ProgramData\Crypthy` is copied only when you register power limits; run **register power limits** once more to get the script that reports failures in Task Scheduler (optional).

### Changed
- **Power limits follow NVIDIA**: the per-GPU target now tracks the live NVIDIA power limit. A limit changed outside Crypthy (for example `nvidia-smi -pl`) is saved and re-applied at logon/boot; a reset to the default value after a reboot or driver restart is not taken over, and a value typed but not yet applied is not overwritten.

### Fixed
- Power limits stopped being re-applied after a card moved to another slot (new PCI bus id): the old id stayed in `power-limits.json` and `nvidia-smi` failed with "No devices were found". Only GPUs seen since the app started are written now, and the file is rewritten as soon as the set of GPUs changes.
- The Windows scheduled task now ends with a failure code when a limit could not be applied, instead of reporting success in Task Scheduler.
- Saving the GPU table no longer writes back an old power limit that changed on the card while the table was open; a live value outside the range the form accepts (for example under 100 W) is not taken over.
- Windows: a GPU that falls back to its default power limit after a reboot or driver restart (while a different limit is set) gets the limit re-applied by the app, at most once every 5 minutes. The logon task alone left the card unlimited when the reset happened after logon. The result is checked against `nvidia-smi`; if the card is still at the default, the app warns and waits an hour before trying again. A typed but not yet applied value is still not applied for you, and a limit set back to the default outside Crypthy is re-applied too (clear the field in settings to stop that).
- Windows: **auto start mining** now checks the live power limits first, applies them if they are not in place, and skips starting with a notification if they still do not match or cannot be read. The miner no longer starts at full power before the logon task has run.

## [0.6.0] - 2026-10-19

Screen layout only: mining, selling and ledger logic, `settings.json`, IPC and the remote API are unchanged, so 0.5.x settings are read as they are.

### Changed
- **HUD** pinned at the top: mining state (mining x/y GPUs / stopped / safety hold / off but mining), start or stop, live net profit, today's net, price and 24 h change, a chip per GPU (temperature, power, hashrate), unread alerts, and remote / MOCK / update badges. Narrow windows (760–1000 px) keep only GPU temperatures, without horizontal scrolling.
- The single long page is split into four tabs: **dashboard** (compact GPU cards with the mine switch, pool and wallet, auto-sell status, latest three alerts, last-hour hashrate line), **profit & ledger**, **sell & cash-out**, **miner** (stats, control method, miner output). The dashboard has no input fields except the mine switches.
- **Settings** moved into a sheet with seven sections — miner, GPU & power, safety, profit, app, remote, coins & miners — with per-section save and cancel, a dot on changed sections, a confirmation before closing with unsaved changes, and validation messages under the field (saving is disabled while a value is invalid). On/off values are toggles, modes are segmented buttons, numbers show their unit, paths have browse buttons.
- Forms moved into dialogs: first-run setup (opens when wallet and pool are not set), auto-sell settings (advanced options folded), SafeTrade API key (the saved key is never shown again), add a sale, backfill (only when there is something to backfill), cash-out memo, and the alert list. Esc and outside clicks close them, asking first if something was typed.
- Remote read-only screens disable every write action and say why; host-only settings stay locked on remote screens as before.
- Auto-sell errors that need the key or the connection checked (authentication, IP restriction, Cloudflare) show a strip with an **API key** button on the sell tab.

### Added
- **Chart window**: one window with four tabs (GPU hashrate/temperature/power, price, daily output and net, cumulative PnL), opened from the HUD (**charts**, price), the dashboard line (**enlarge**) or the tray (**open charts**). Only one opens; it remembers its size, position and last tab, stays open when the main window is hidden and shows the remote host's data while connected.
- The tray tooltip adds live net profit and today's net.

## [0.5.2] - 2026-10-19

### Fixed
- **Auto-sell used the old market**: on 2026-10-18 SafeTrade renamed PRL/USDT to **PEARL/USDT** (`pearlusdt`, currency `pearl`) and disabled `prlusdt`/`prlusdc` (public `/trade/public/markets`, checked 2026-10-19). Auto-sell now looks up an enabled market with base currency `pearl` (or `prl`) and the chosen quote (USDT/USDC) in the market list at each run, and reads the balance of that currency. Saved settings keep working.
- SafeTrade's Cloudflare blocks plain Node requests (403 "Attention Required"); the desktop app now sends SafeTrade requests through Electron's network stack (`net.fetch`), which passes. On a headless host the block is reported clearly and the day is skipped.

### Changed
- Sell fee: taken from the fills, else the public taker rate (`/trade/public/trading_fees`, 0.1%), else 0.1%. A dry run shows the estimated fee.
- Cash-out memo: PEARL/USDT (renamed), SafeTrade sell fee 0.1% (measured 2026-10-19, editable).

## [0.5.1] - 2026-10-19

### Fixed
- **Cumulative output was higher than the pool** (reported: about 13 PRL in Crypthy vs 10.59 PRL = payouts 8.81 + pool balance 1.79). Kryptex lists a payout first as *paying* without a txid and then as *finished* with a txid; payouts were identified by txid, so a payout seen in both states was counted twice in the payout total, the lifetime output and the PnL. Payouts are now identified by payout time and amount (also matched when the time shifts within a day), and failed or cancelled payouts are not counted.
- **Existing ledgers are corrected once** at the first pool check after the update: with the full payout list, the payout total is rebuilt from the list and the lifetime output set to pool balance + payouts; duplicate payouts found in the event log (including the other OS's log in a shared ledger) are removed from the PnL on the day they were counted, at that day's price, through `adjust` events that a shared ledger applies once. An alert shows the amount removed.
- If the pool total (balance + payouts) stays below the recorded cumulative for an hour (for example a payout listed before the balance dropped), the cumulative is lowered to the pool total and the PnL corrected.
- Shared ledger (dual boot): a corrected baseline from the other OS is taken even though it is lower; a baseline from an older Crypthy is offset by the corrected amount and an alert asks to update that device (update the headless host too).

### Changed
- The profit card shows **paid / paying / pool balance (unpaid)** under the lifetime output, to compare with the wallet. The PnL cumulative output shows the pool-confirmed amount, with the live estimate separately.

## [0.5.0] - 2026-10-19

Start with a dry run: create a SafeTrade API key with **trade permission only** (no withdrawal, IP restriction if possible), enter it on the **SafeTrade auto-sell** card, set a minimum price, run **dry run** and check the plan, then turn dry run off.

### Added
- **SafeTrade auto-sell** (off by default, starts as a dry run): once a day at a set time, sells the PRL available on SafeTrade (minus an amount you keep) through SafeTrade's official API (`safetrade.com/api`, signed with `X-Auth-Apikey`/`X-Auth-Nonce`/`X-Auth-Signature`). Limit orders only, one tick under the best ask, cancelled and placed a step lower after N minutes; **never below the floor** = max(minimum price, reference × (1 − X%)), reference = higher of SafeTrade's 24 h average and CoinGecko. A minimum price is required for real sales.
- An abnormal book (spread, thin bids, API error) skips the day with an alert. Daily and per-order limits, PRL markets only (`prlusdt`, `prlusdc`). The order response must match side, type, market, price and amount, or the order is cancelled.
- Sales are recorded as realized sales in the PnL and in the shared ledger (order ids, average price, fee, USDT). Once a day on one device: the day is marked before the first order, a shared-ledger folder keeps a per-day (UTC) record, and if the app stops mid-sale the open order is cancelled and what sold is recorded at the next start. Switching auto-sell off stops before the next order.
- Key handling: entered by you in the app and encrypted with the OS secure storage (Windows DPAPI; Linux only with a real keyring), or on a headless host `install.sh --safetrade-key FILE` → `/etc/crypthy/safetrade-key.json` (root 0600) passed with systemd `LoadCredential`, or a 0600 file in the data folder. The key is never sent back to the screen, to remote screens, the status API, logs or error messages.
- Remote API: `POST /v1/autosell/run` (write token; real sales ask for confirmation). A remote screen can only switch auto-sell on or off, dry run and the time; the floor, limits and market are changed on the host. Turning on real sales or loosening limits asks for confirmation.
- Reminders only (no automation of withdrawals or wallet sending): PRL to send to SafeTrade when there is nothing to sell, and a weekly (Sunday) withdrawal suggestion.
- **Cash-out route memo** with editable fees and measured date (2026-10-19): Pearl wallet → SafeTrade (no fee, minimum 1 PRL, 10 confirmations) → PRL/USDT → Binance (USDT BSC, 1 USDT fixed fee, minimum 2) → Upbit/Bithumb (travel rule). Sell daily, withdraw weekly.

## [0.4.5] - 2026-10-18

To mine only on the RTX 5080: SRBMiner's device numbers can differ from nvidia-smi because of an integrated GPU (with an AMD iGPU as GPU0, the RTX 5080 is `--gpu-id 2`); the app maps them automatically.

### Fixed
- Per-GPU mining did not apply to SRBMiner (Pearl, Windows): SRBMiner ignores `CUDA_VISIBLE_DEVICES`, so a GPU switched off kept mining. SRBMiner now gets `--gpu-id` with its own device numbers for the chosen cards. Those numbers differ from nvidia-smi (on the reporting PC RTX 5090 = 1, RTX 5080 = 2), so they are mapped by PCI bus from SRBMiner's stats API (learned while all cards mine) or from `SRBMiner-MULTI --list-devices` (raw output kept in `logs/srb-list-devices.txt`), cached per miner, cards and driver version. Other miners still get `CUDA_VISIBLE_DEVICES`.
- If the cards cannot be mapped, mining is not blocked: it starts on all cards and the miner card and alerts say "card selection could not be applied — mining on all cards" with the reason. The "off but mining" check stays as verification.

## [0.4.4] - 2026-10-18

### Added
- **Per-GPU mining** (executable method, NVIDIA): a **mine** switch on each GPU card. Only the chosen GPUs are visible to the miner (`CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES` by GPU UUID from nvidia-smi, else by PCI bus order), so the miner's own device numbers are not needed. A running miner restarts with the new choice and stops when no GPU is left; the choice is saved and used by automatic start. A `--gpu-id` argument is left out while a choice is active.
- GPUs that are not mining are left out of the power cost (PnL, live estimate, backfill watts) and of power limits; a danger condition on them warns once instead of stopping the miner or setting a hold. A hashrate on a GPU that is off is flagged (the miner does not follow the choice).
- Remote API: `POST /v1/miner/gpu` (write token).

## [0.4.3] - 2026-10-18

### Fixed
- The miner console window still opened when the method was **scheduled task**: Task Scheduler launches the miner itself, so hiding only applied to the executable method. **Switch to executable** (formerly "import from scheduled task") now reads the task's executable and arguments, unwraps a `conhost --headless` wrapper, and changes the method to **executable** with the window hidden. Task mode shows why its window cannot be hidden.

### Added
- **View miner window** on the miner card: the miner's output goes to `logs/miner.log` (rotated at 2 MB) and is shown in the app only when you open it.
- **Disable scheduled task** (asks first) when the method is executable but the old task is still enabled, so it does not start a second miner with a console window at logon.
- **Browse…** buttons with the file dialog for the miner executable and the shared ledger folder (disabled while viewing a remote host).

## [0.4.2] - 2026-10-18

### Added
- **Start mining when Crypthy starts** (off by default): 30 s after start the configured miner is started once. It needs the risk and cost notice (asked when you turn it on) and is skipped, with the reason in the alerts, on a safety hold, a danger stop in the last 6 hours or a miner that is already running (for example started by a scheduled task). A miner stopped for danger is still never restarted.
- **Hide miner console window** for the executable method (on by default): the miner starts without a console window on Windows.
- **Show window at login**: start at login can open the window instead of the tray only.
- README: how to replace a scheduled task that opens a console window with Crypthy at login.

## [0.4.1] - 2026-10-18

### Added
- **Shared ledger for a dual boot** (Windows Crypthy ↔ Linux `crypthy-headless`): Settings → shared ledger folder (headless: `--shared-ledger DIR`). Each instance appends only to its own `crypthy/pnl/events-<instance id>.jsonl`; the PnL is recomputed from all instances, so both OSes show the same totals. The pool baseline (last total, payouts seen) is shared with a generation number, so a pool increase or payout is counted once whichever OS sees it. Coin, wallet, pool and profit settings are shared; miner on/off, remote API and power limits stay per OS.
- The first time, the existing local ledger is exported to the shared folder; events already copied between the two data folders are counted once. Without the folder (not mounted) Crypthy keeps energy and sales locally and catches up later, and records no pool increase meanwhile so nothing is counted twice; the Linux service waits for the mount. Overlapping energy records of two instances are flagged.
- Events now carry an id; the backfill event carries its per-day amounts so every instance recomputes the same backfill.

## [0.4.0] - 2026-10-18

Not yet tested on a real Ubuntu Server, Tailscale or Vast.ai host.

### Added
- **Headless host** (`crypthy-headless-<version>.tar.gz`, Node.js 18+): runs the monitor, safety stop and profit tracking as a systemd service on a PC without a screen. `install.sh` (sudo) installs to `/opt/crypthy-headless`, keeps data and tokens in `/var/lib/crypthy-headless` (owner only), runs the service as a normal user and can install the GPU power-limit service with the same sudo. No automatic updates.
- **Remote API** on the headless host: listens on 127.0.0.1 or one specific IP (for example the Tailscale IP, never 0.0.0.0), read token for the full state and charts, writes (start/stop, settings, clear holds, sales, backfill) only with `--enable-write` and a separate write token. Host header check, wallet address never sent (also masked inside miner arguments), the old `/v1/status` stays open to this PC only. Remote settings changes are limited to coin, wallet, pool, miner stats API, GPUs, profit and update interval; the miner command, safety settings and start at login can only be changed on the host.
- **Remote screen** in the app: Settings → remote host (address, read token, optional write token). The dashboard and tray show the host; start/stop and settings go to the host, and the host's confirmations (risk notice, recent danger stop, stop) are asked on this PC. Tokens stay in the main process, encrypted with the OS keychain.
- `--accept-risk` for the first start on a headless host. After a danger stop the miner is still never restarted.
- CI installs the headless package on Ubuntu with systemd and Node 18 and checks the API (tokens, Host header, read-only default, 0.0.0.0 refused, clean stop). More tests that Vast.ai customer and defjob containers are never stopped.

### Changed
- State, polling, safety and actions moved into `core.ts`, shared by the desktop app and the headless host.

## [0.3.9] - 2026-10-18

### Fixed
- Installing the 0.3.8 update left one Windows PC with a broken app ("This app can't run on your PC") and Crypthy no longer started. The same in-app update (0.3.7 → 0.3.8) works on a clean Windows runner, so the trigger on that PC is not confirmed; during the update `Crypthy.exe` is briefly missing or half-written, and when the silent installer cannot replace the files it overwrites them ignoring errors and starts the app anyway (`--force-run`). The installer now checks the installed `Crypthy.exe` version before starting it; on a mismatch it does not start the app, explains how to reinstall and opens the release page.
- Before handing over to the installer the app now releases everything it holds: timers, the local status API server, the tray, all windows and the close guards of the tray app.

**If 0.3.8 left Crypthy broken:** download `Crypthy-0.3.9-setup-x64.exe` from [Releases](https://github.com/Ruderud/crypthy/releases/tag/v0.3.9) and run it. Settings, ledger and PnL data in `%APPDATA%\Crypthy` are kept.

### Added
- File log at `%APPDATA%\Crypthy\logs\main.log` (rotated at 1 MB): app start and quit, update states, installer hand-over and uncaught errors, plus electron-updater's own log.
- Windows CI smoke test on every push: (1) install the latest release, start it, then run the new installer with electron-updater's arguments; (2) let the installed app download the new version from a local update server and install it from inside the app; (3) hold `Crypthy.exe` open from another process. Each must end on the new version with user data kept, or, when the file cannot be replaced, show an error and never start a half-installed app.

## [0.3.8] - 2026-10-18

### Changed
- Update notices appear once. The native update dialog added in 0.3.5 is removed; **download / later** and **restart now to install / later** are only in the in-app banner.
- An OS notification is shown only when the window is hidden or minimized (tray). Clicking it opens the window, scrolls to the top and highlights the banner; the tray's new-version item does the same. A manual check shows the banner only.

## [0.3.7] - 2026-10-18

### Added
- **Mining on/off** from the miner card and the tray for a miner you configured yourself: a Windows scheduled task (`schtasks /Run`, `/End`), a Linux systemd user unit (`systemctl --user start|stop`) or an executable with arguments (run without a shell, detached from the app). Stopping also stops the miner process and confirms it. Crypthy still does not download or install miners.
- The first start asks you to accept a risk and cost notice; stopping asks once for confirmation (can be turned off).
- **Import from scheduled task** fills the executable and arguments from the task (Windows). The configured executable is added to the processes the app watches and stops.
- The local status API reports `mode: "app"` for a miner started with the app.

### Changed
- If a miner is already running, start is disabled and the card shows that it was started outside the app; a second miner is never launched.
- After a danger stop the app still never starts the miner by itself. With a scheduled task or systemd unit the safety stop also ends the task or unit, so a supervisor (for example `Restart=always`) cannot restart the miner. Start stays disabled until the hold is cleared, and the next start shows the cause again.
- Shells and interpreters (`cmd`, `powershell`, `python`, …) are refused as the miner executable, so the app never watches or stops unrelated windows. Start is refused while the process list cannot be read.
- A miner started as administrator that the app cannot stop is reported with instructions to stop it in Task Manager.

## [0.3.6] - 2026-10-18

### Changed
- **Today / this month profit** is one number: (pool-confirmed output + backfilled output + live estimate not yet reflected by the pool) × price − power cost of the same period, with the breakdown under it and in a tooltip. Previously the dashboard showed separate estimate and confirmed rows, and output mined before the app saw the pool was missing from this month until you backfilled by hand.
- Pool increases are split across days by time since the previous increase, so an increase spanning midnight is shared by both days.
- The PnL table adds a "this month" row.

### Added
- Automatic backfill: once hashrate, pool statistics and GPU power are known, output mined before tracking started is backfilled with a start time estimated as pool total ÷ current expected rate (never later than the earliest payout) and the current GPU power. Existing books with a tracking start and no backfill are backfilled the same way after updating.
- The backfill can be recalculated with a corrected start time and wattage; the previous backfill is replaced, not added. A backfill applied in 0.3.4/0.3.5 is separated from the daily book on first start so it can be recalculated too.

## [0.3.5] - 2026-10-18

### Fixed
- Clicking the update notification did nothing visible. On Windows the notification object could be garbage-collected so its click was lost, and the update banner sits at the top of the page, so with the window scrolled down it was off-screen. Notifications are now kept until clicked or closed, and the header and update banner stay pinned at the top.
- A window that is shown again receives the current state immediately.

### Added
- Clicking the update notification, **check for updates** (header or tray) or the tray's new-version item opens a dialog: **download / later**, then **restart now to install / later** once the download started from it finishes. The in-app banner keeps the same buttons.

## [0.3.4] - 2026-10-18

### Added
- Cumulative PnL: an append-only local event log (`pnl/events.jsonl`, rotated at 5 MB) and daily totals without a time limit (`pnl/daily.json`). Shows total PnL (realized + unrealized − energy cost), lifetime mined, holdings, realized and unrealized for today / 7 / 30 days / all, with a daily net bar and cumulative PnL chart.
- One-time backfill of output mined before tracking started, with estimated energy; backfilled values are marked estimated.
- Optional manual sale records for realized PnL, CSV export of daily totals and events, and an "open log folder" button.
- The local status API includes a `pnl` object with rounded totals only.
- README in English (default), Korean (`README.ko.md`) and Simplified Chinese (`README.zh-CN.md`) with a language switcher; CI checks that the three stay structurally in sync.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull request templates, Dependabot configuration.

### Changed
- Kryptex payout timestamps are parsed.
- README reorganized: badges, features, screenshots, download and install, quick start, configuration, safety and privacy, FAQ, contributing, acknowledgements.
- Release notes are taken from this changelog.

## [0.3.3] - 2026-10-18

### Changed
- Vast rental price uses verified offers only by default, separates on-demand and interruptible offers, supports a country filter and drops offers below 80% of the median DLPerf. The comparison shows median, 25th percentile, sample count and query time, and "insufficient data" below 5 samples.

## [0.3.2] - 2026-10-18

### Fixed
- Net profit no longer shows negative values caused by mismatched periods. Profit is split into a live estimate (measured hashrate × pool statistics) and pool-confirmed output paired with the energy of the same period, shown as "collecting" until 3 paired hours exist.
- Missing price shows "no price" instead of 0 or a negative value; the last good price is cached with its time.

### Changed
- Ledgers from 0.3.1 and earlier are migrated: the pool baseline is kept and old daily values are excluded from net profit.

## [0.3.1] - 2026-10-18

### Changed
- Update checks run a few seconds after launch and then every hour (configurable 30 minutes to 24 hours).
- New versions are announced with an in-app banner and an OS notification (download / later, then restart to install / later); "later" hides the notice until the next scheduled check.

### Added
- "Check for updates" in the header and the tray menu.
- Release notes generated from commit titles.

## [0.3.0] - 2026-10-17

### Added
- Ubuntu (Linux) support: AppImage (auto-update) and deb packages.
- Linux miner detection via `/proc`; container workloads (docker, containerd, podman, lxc, other PID namespaces) are never stopped.
- Linux power limits through a systemd oneshot service and a polkit rule installed with one `pkexec` authentication.
- Linux start at login via XDG autostart.
- CI test matrix on Ubuntu and Windows; releases include Windows and Linux builds and one `SHA256SUMS.txt`.

## [0.2.1] - 2026-10-17

### Added
- Charts with TradingView Lightweight Charts: per-GPU hashrate, temperature and power history, 30-day coin price, daily output and net profit.
- Dark exchange-style theme with light and system themes.
- `docs/ROADMAP.md`.

## [0.2.0] - 2026-10-17

### Changed
- Crypthy no longer downloads, installs, starts or restarts miners. It monitors running miners and GPUs.
- The safety watch stops known running miners on danger and puts the GPU on hold; it never restarts them.

### Added
- Coin hub: curated catalog of coins and compatible mining tools with official repository links, supported GPU vendors and verified dev fees.
- Miner stats API adapter (SRBMiner-MULTI).

### Removed
- SRBMiner download and installation, miner argument assembly and launch, GPU mapping detection.

## [0.1.0] - 2026-10-17

### Added
- First release: Windows tray app with GPU dashboard (nvidia-smi), SRBMiner control, fan/temperature safety watch, power limits through a one-time UAC scheduled task, Kryptex profit tracking, mining vs rental comparison, read-only local status API, NSIS installer with auto-update.

[Unreleased]: https://github.com/Ruderud/crypthy/compare/v0.4.5...HEAD
[0.4.5]: https://github.com/Ruderud/crypthy/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/Ruderud/crypthy/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/Ruderud/crypthy/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/Ruderud/crypthy/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/Ruderud/crypthy/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/Ruderud/crypthy/compare/v0.3.9...v0.4.0
[0.3.9]: https://github.com/Ruderud/crypthy/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/Ruderud/crypthy/compare/v0.3.7...v0.3.8
[0.3.7]: https://github.com/Ruderud/crypthy/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/Ruderud/crypthy/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Ruderud/crypthy/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Ruderud/crypthy/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Ruderud/crypthy/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Ruderud/crypthy/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Ruderud/crypthy/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Ruderud/crypthy/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Ruderud/crypthy/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ruderud/crypthy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ruderud/crypthy/releases/tag/v0.1.0
