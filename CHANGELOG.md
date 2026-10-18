# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, minor versions may contain breaking changes.

Release notes on GitHub are taken from the matching section of this file.

## [Unreleased]

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

[Unreleased]: https://github.com/Ruderud/crypthy/compare/v0.3.9...HEAD
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
