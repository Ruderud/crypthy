# Contributing to Crypthy

Thanks for your interest. Bug reports, catalog corrections, translations and code changes are welcome.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security issues privately as described in [SECURITY.md](SECURITY.md), not in public issues.
- For larger changes, open an issue first to discuss the approach.

## Project principles

Changes must keep these guarantees (see "Safety and privacy" in the [README](README.md)):

- Crypthy never downloads or installs miners and never builds miner command lines. It starts or stops only a miner the user configured, only when the user clicks, and never restarts one after a safety stop.
- No default wallet, no dev fee, no telemetry. Never ask for or store wallet seeds, passwords or tokens.
- The safety watch may only stop known miner processes, and must never touch container workloads on Linux.
- Do not change operating-system security settings (Defender, firewall, etc.).
- Outgoing network requests are limited to public read-only APIs; document any new one.

## Development setup

Requirements: Node.js 24 and npm. Windows or Linux is needed to run against real hardware; on macOS use mock mode.

```bash
npm install
npm run typecheck
npm test
npm run check:readme
npm run start:mock
```

Mock mode options (`CRYPTHY_MOCK_FANSTOP`, `CRYPTHY_MOCK_KILLFAIL`, `CRYPTHY_MOCK_IDLE`, `CRYPTHY_MOCK_UPDATE`) are listed in the README.

## Making changes

- Keep changes small and focused; one feature or fix per pull request.
- Add or update unit tests next to the code (`src/main/*.test.ts`). Safety, profit and parsing logic must be covered.
- Run `npm run typecheck`, `npm test` and `npm run check:readme` before opening a pull request. CI runs them on Ubuntu and Windows.
- Use [Conventional Commits](https://www.conventionalcommits.org/) style subjects (`feat:`, `fix:`, `docs:`, `ci:`, `build:`, `chore:`).
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Catalog changes

`catalog/catalog.json` lists coins and mining tools. Every value needs a source URL and a check date. Mark values you could not confirm as unverified; do not link a repository you could not confirm as official. Tests enforce part of this.

## Documentation and translations

`README.md` (English) is the source; `README.ko.md` and `README.zh-CN.md` must keep the same structure, code blocks and links (`npm run check:readme`). If you cannot translate a change, update the English README and mention it in the pull request so the translations can follow.

The app UI is currently Korean only; contributions that add UI translations are welcome.

## Releases

Maintainers release by moving the `Unreleased` changelog entries into a version section, bumping `package.json`, and pushing a `v*` tag. The Release workflow builds Windows and Linux packages and uses that changelog section as release notes.
