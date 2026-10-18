# Security Policy

## Supported versions

Only the latest release receives fixes. Installed copies update through the in-app updater (Windows installer and Linux AppImage).

| Version | Supported |
|---|---|
| latest release | yes |
| older releases | no |

## Reporting a vulnerability

Please do not report security issues in public issues, discussions or pull requests.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- affected version and platform (Windows / Linux)
- steps to reproduce or a proof of concept
- impact (for example privilege escalation through the power-limit task or service, a way to make the safety watch stop non-miner or container processes, or exposure of local data through the status API)

You can expect an acknowledgement within 7 days. Please allow time for a fix and a release before public disclosure.

## Scope notes

- Crypthy does not ship mining software. Vulnerabilities in third-party miners should be reported to their maintainers.
- Builds are not code-signed. Verify downloads with `SHA256SUMS.txt` from the release.
- The local status API listens on `127.0.0.1` only and is read-only; reports of remote exposure are in scope.
