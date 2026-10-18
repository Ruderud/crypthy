# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below 1.0.0, minor versions may contain breaking changes.

Release notes on GitHub are taken from the matching section of this file.

## [Unreleased]

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

[Unreleased]: https://github.com/Ruderud/crypthy/compare/v0.3.4...HEAD
[0.3.4]: https://github.com/Ruderud/crypthy/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Ruderud/crypthy/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Ruderud/crypthy/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Ruderud/crypthy/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Ruderud/crypthy/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Ruderud/crypthy/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ruderud/crypthy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ruderud/crypthy/releases/tag/v0.1.0
