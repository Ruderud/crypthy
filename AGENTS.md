# Crypthy repository guidance

- Keep Electron main-process services in `src/main` and renderer code in `src/renderer`.
- Keep renderer access to the filesystem, subprocesses, and network behind the existing preload and IPC boundaries.
- Use `npm ci` for dependency setup. Verify changes with `npm run typecheck`, `npm test`, and `npm run build`.
- Use mock mode for UI verification without starting miners or applying hardware settings.
- Keep live mining settings, wallet credentials, and generated installers out of Git.
