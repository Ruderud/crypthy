// 헤드리스 Crypthy: 화면 없이 코어(감시·안전 정지·수익)를 돌리고, 원격 API 로 다른 PC 의 Crypthy 가 붙는다.
// Ubuntu Server 의 systemd 서비스(crypthy-headless)로 쓰는 것을 전제로 한다. Electron 없이 Node 로 실행.
//   node dist/main/headless.js --data-dir /var/lib/crypthy --bind 100.x.y.z [--enable-write] [--accept-risk]
import fs from 'node:fs';
import path from 'node:path';
import type { Alert } from '../shared/types';
import { NeedConfirm, type Confirm, type ConfirmKind } from './confirm';
import * as core from './core';
import { readJson } from './config';
import { HEADLESS_USAGE, parseHeadlessArgs, type HeadlessFileConfig } from './headlessArgs';
import { createFileLogger, type Logger } from './log';
import { ensureToken, startRemoteApi, validateBind } from './remoteApi';

/** 원격 요청에 담긴 확인만 받는다. 없으면 클라이언트가 사용자에게 묻도록 409 로 돌려보낸다 */
const acceptFrom = (accept: ConfirmKind[]): Confirm => async (kind, detail) => {
  if (accept.includes(kind)) return true;
  throw new NeedConfirm(kind, detail);
};

function consoleAndFile(file: Logger): Logger {
  const line = (level: string, args: unknown[]) => `[${level}] ${args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  return {
    info: (...a) => (console.log(line('info', a)), file.info(...a)),
    warn: (...a) => (console.warn(line('warn', a)), file.warn(...a)),
    error: (...a) => (console.error(line('error', a)), file.error(...a)),
    debug: () => undefined,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const first = parseHeadlessArgs(argv, process.env);
  const opts = parseHeadlessArgs(argv, process.env, readJson<HeadlessFileConfig>(path.join(first.dataDir, 'remote-api.json'), {}));
  if (opts.help) {
    process.stdout.write(HEADLESS_USAGE);
    return;
  }
  const bindErr = validateBind(opts.bind);
  if (bindErr) throw new Error(bindErr);
  fs.mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
  const readFile = path.join(opts.dataDir, 'remote-read.token');
  const writeFile = path.join(opts.dataDir, 'remote-write.token');
  const readToken = ensureToken(readFile);
  const writeToken = opts.enableWrite ? ensureToken(writeFile) : null;
  if (opts.printTokens) {
    // 사용자가 직접 요청했을 때만 토큰을 출력한다 (로그에는 남기지 않는다). 쓰기 토큰은 서비스가 만들어 둔 것이 있으면 보여 준다
    let write = writeToken;
    try {
      write ??= fs.readFileSync(writeFile, 'utf8').trim() || null;
    } catch {
      write = null;
    }
    process.stdout.write(`read:  ${readToken}\n${write ? `write: ${write}\n` : 'write: (disabled — the service runs without --enable-write)\n'}`);
    return;
  }

  const version = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  const log = consoleAndFile(createFileLogger(path.join(opts.dataDir, 'logs', 'main.log')));
  process.on('uncaughtException', (e) => log.error('uncaughtException', e));
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
  log.info(`Crypthy headless v${version} — data ${opts.dataDir}`);

  await core.initCore({
    dataDir: opts.dataDir,
    version,
    resourcesDir: path.join(__dirname, '..', '..', 'resources'),
    log,
    sharedLedgerDir: opts.sharedLedger ?? undefined,
    notify: (a: Alert) => log[a.level === 'critical' ? 'error' : a.level === 'warn' ? 'warn' : 'info'](`alert ${a.code}${a.gpu ? ` ${a.gpu}` : ''}: ${a.message}`),
    onChange: () => undefined,
  });
  if (opts.acceptRisk) {
    core.acceptRisk();
    log.info('mining risk and cost notice accepted (--accept-risk)');
  }

  const server = startRemoteApi(
    { bind: opts.bind, port: opts.port, readToken, writeToken },
    {
      state: core.buildState,
      charts: core.chartsView,
      start: (accept) => core.startMining(acceptFrom(accept)),
      stop: (accept) => core.stopMining(acceptFrom(accept)),
      setGpu: (id, mine, accept) => core.setGpuMining(id, mine, acceptFrom(accept)),
      saveSettings: core.saveSettingsPatch,
      clearHold: core.clearHold,
      addSale: core.addSaleRecord,
      backfill: core.backfillPnl,
    },
    (e) => {
      // 부팅 직후 Tailscale IP 가 아직 없으면(EADDRNOTAVAIL) 끝내고 systemd 가 다시 띄우게 한다
      log.error(`remote API: ${e.message}`);
      core.saveAll(true);
      process.exit(1);
    },
  );
  log.info(`remote API http://${opts.bind.includes(':') ? `[${opts.bind}]` : opts.bind}:${opts.port} (${writeToken ? 'read + write' : 'read-only'})`);
  log.info(`tokens: ${readFile}${writeToken ? `, ${writeFile}` : ''} (owner-only; show with --print-tokens)`);

  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${sig}: saving and stopping`);
    core.stopCore();
    core.saveAll(true);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((e) => {
  console.error(`crypthy-headless: ${(e as Error).message}`);
  process.exit(1);
});
