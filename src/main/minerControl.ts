// 채굴 켜기·끄기: 사용자가 직접 구성한 채굴기만 실행·정지한다. 채굴기를 내려받거나 설치하지 않는다.
//  - task:    Windows 예약 작업 (schtasks /Run, /End)
//  - systemd: Linux systemd --user 유닛 (systemctl --user start|stop)
//  - direct:  사용자가 지정한 실행 파일 + 인자 (셸 없이, 앱과 분리해 실행)
// 끄기는 위 정지 명령 뒤에 알려진 채굴기 프로세스 정지(안전 정지와 같은 경로)로 마무리한다.
// 자동 재시작은 하지 않는다: start 는 사용자가 누를 때만 불린다.
import path from 'node:path';
import type { MinerControlConfig } from '../shared/types';

export type Platform = 'windows' | 'linux' | 'other';

export interface Command {
  file: string;
  args: string[];
}

const CONTROL_CHARS = /[\0-\x1f\x7f]/;
/** C:\… 나 \\server\… 형태면 Windows 경로 규칙으로 */
const pathOf = (p: string) => (/^[a-z]:[\\/]|^\\\\/i.test(p) ? path.win32 : path.posix);

/**
 * 인자 문자열을 셸 없이 나눈다. 공백으로 구분하고 "…" 안의 공백은 유지, 따옴표 안의 \" 는 따옴표 문자.
 * 셸 메타문자(& | > 등)는 특별한 의미 없이 그대로 인자에 들어간다. 제어 문자·닫히지 않은 따옴표는 오류.
 */
export function parseArgs(s: string): string[] {
  if (CONTROL_CHARS.test(s.replace(/\t/g, ' '))) throw new Error('인자에 줄바꿈·제어 문자를 쓸 수 없습니다');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted && c === '\\' && s[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
      has = true;
    } else if (!quoted && (c === ' ' || c === '\t')) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있습니다');
  if (has || cur) out.push(cur);
  return out;
}

/** 셸·스크립트 인터프리터: 채굴기 이름으로 쓰면 다른 창·스크립트까지 감지·강제 종료하게 된다 */
const INTERPRETERS = new Set(['cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'conhost', 'explorer', 'rundll32', 'python', 'python3', 'pythonw', 'node', 'bash', 'sh', 'zsh', 'dash', 'env', 'sudo', 'java', 'javaw', 'wsl', 'start', 'systemctl', 'schtasks']);
const NAME_RE = /^[\w.+-]{1,100}$/;

/** 감지·정지 대상으로 쓸 수 있는 실행 파일 이름인가 (인터프리터·셸 제외) */
export function isUsableProcessName(name: string): boolean {
  return NAME_RE.test(name) && !INTERPRETERS.has(name.toLowerCase().replace(/\.exe$/, ''));
}

const TASK_RE = /^\\?[^"<>|*?/\\:\0-\x1f-][^"<>|*?:\0-\x1f]{0,229}$/;
const UNIT_RE = /^[A-Za-z0-9_.@:\\-]{1,250}$/;

/** 설정 형식 확인 (실행 파일 존재 여부는 호출부가 확인) */
export function validateControl(c: MinerControlConfig, platform: Platform): string | null {
  if (c.mode === 'none') return null;
  if (c.mode === 'task') {
    if (platform !== 'windows') return '예약 작업 방식은 Windows 에서만 쓸 수 있습니다';
    if (!TASK_RE.test(c.taskName) || c.taskName.trim() !== c.taskName) return '예약 작업 이름을 확인해 주세요 (따옴표·<>|*? 불가, - 나 / 로 시작 불가)';
  }
  if (c.mode === 'systemd') {
    if (platform !== 'linux') return 'systemd 방식은 Linux 에서만 쓸 수 있습니다';
    if (!UNIT_RE.test(c.unit) || c.unit.startsWith('-')) return 'systemd 유닛 이름을 확인해 주세요 (예: srbminer.service)';
  }
  if (c.mode === 'direct') {
    const abs = platform === 'windows' ? path.win32.isAbsolute(c.exe) : path.posix.isAbsolute(c.exe);
    if (!c.exe || !abs || CONTROL_CHARS.test(c.exe)) return '채굴기 실행 파일은 절대 경로여야 합니다';
    // .bat/.cmd 는 cmd.exe 를 거쳐 인자가 해석되므로 받지 않는다
    if (platform === 'windows' && !/\.exe$/i.test(c.exe)) return 'Windows 에서는 .exe 파일만 직접 실행할 수 있습니다 (bat 은 예약 작업으로 등록해 주세요)';
  }
  if (c.exe && CONTROL_CHARS.test(c.exe)) return '채굴기 실행 파일 경로를 확인해 주세요';
  if (c.exe && !isUsableProcessName(pathOf(c.exe).basename(c.exe))) return '채굴기 실행 파일은 채굴기 자체여야 합니다 (cmd·powershell 같은 셸·인터프리터는 쓸 수 없습니다)';
  try {
    parseArgs(c.args);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/** 켜기 명령. direct 는 spawn(분리 실행) 대상, 나머지는 끝날 때까지 기다리는 명령 */
export function startCommand(c: MinerControlConfig): { kind: 'exec' | 'spawn'; cmd: Command; cwd?: string; hide?: boolean } | null {
  switch (c.mode) {
    case 'task':
      return { kind: 'exec', cmd: { file: 'schtasks.exe', args: ['/Run', '/TN', c.taskName] } };
    case 'systemd':
      return { kind: 'exec', cmd: { file: 'systemctl', args: ['--user', 'start', '--', c.unit] } };
    case 'direct':
      return { kind: 'spawn', cmd: { file: c.exe, args: parseArgs(c.args) }, cwd: pathOf(c.exe).dirname(c.exe), hide: c.hideWindow !== false };
    default:
      return null;
  }
}

/** 끄기 명령 (direct 는 없음 — 프로세스 정지로 끈다) */
export function stopCommand(c: MinerControlConfig): Command | null {
  if (c.mode === 'task') return { file: 'schtasks.exe', args: ['/End', '/TN', c.taskName] };
  if (c.mode === 'systemd') return { file: 'systemctl', args: ['--user', 'stop', '--', c.unit] };
  return null;
}

/** 지정한 실행 파일 이름 (감지·정지 대상에 더함). 경로가 없으면 null */
export function controlProcessName(c: MinerControlConfig, platform: Platform): string | null {
  if (!c.exe || c.mode === 'none') return null;
  const name = platform === 'windows' ? path.win32.basename(c.exe) : path.posix.basename(c.exe);
  return name && isUsableProcessName(name) ? name : null;
}

const xmlText = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** `schtasks /Query /TN <name> /XML` 의 첫 Exec 동작에서 실행 파일·인자 */
export function parseTaskXml(xml: string): { exe: string; args: string } | null {
  const exec = /<Exec>([\s\S]*?)<\/Exec>/.exec(xml)?.[1];
  if (!exec) return null;
  const cmd = /<Command>([\s\S]*?)<\/Command>/.exec(exec)?.[1];
  if (!cmd) return null;
  const args = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(exec)?.[1] ?? '';
  return { exe: xmlText(cmd.trim()).replace(/^"(.*)"$/, '$1'), args: xmlText(args.trim()) };
}

/** schtasks 출력: BOM 이 있으면 UTF-16LE */
export function decodeConsole(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/** 켜기를 막는 이유. 위험 정지 뒤 보류가 남아 있으면 자동으로도, 버튼으로도 켜지 않는다 */
export function startBlocker(o: { config: MinerControlConfig; platform: Platform; running: boolean; holds: string[]; starting: boolean; procsUnknown?: boolean }): string | null {
  if (o.config.mode === 'none') return '설정 → 채굴 켜기·끄기에서 방식을 먼저 고르세요';
  const err = validateControl(o.config, o.platform);
  if (err) return err;
  if (o.starting) return '켜는 중입니다';
  if (o.running) return '채굴기가 이미 실행 중입니다 (두 번째 채굴기는 띄우지 않습니다)';
  if (o.procsUnknown) return '프로세스 목록을 읽지 못해 실행 중인지 확인할 수 없습니다 — 잠시 뒤 다시 시도해 주세요';
  if (o.holds.length) return `안전 보류 중: ${o.holds.join(', ')} — 원인을 해결하고 GPU 카드에서 보류를 해제한 뒤 켜 주세요`;
  return null;
}

/**
 * 직접 실행 옵션: 셸 없이, 앱과 분리해(앱을 꺼도 채굴은 계속).
 * hide 면 Windows 에서 콘솔 창 없이 (Node 의 windowsHide → CREATE_NO_WINDOW + SW_HIDE)
 */
export function spawnOptions(cwd: string | undefined, hide: boolean) {
  return { cwd, detached: true, stdio: 'ignore' as const, shell: false, windowsHide: hide };
}

/**
 * Crypthy 시작 시 채굴 자동 시작을 할지. 안전 원칙은 버튼과 같고, 묻는 대신 하지 않는다:
 * 동의 전, 안전 보류 중, 최근 위험 정지, 이미 실행 중(예: 예약 작업이 먼저 띄움)·그 밖에 켤 수 없는 이유가 있으면 건너뛴다.
 */
export function autoStartDecision(o: { enabled: boolean; consented: boolean; recentDanger: boolean; blocker: string | null }): { start: boolean; reason: string | null } {
  if (!o.enabled) return { start: false, reason: null };
  if (!o.consented) return { start: false, reason: '채굴 위험·비용 고지에 아직 동의하지 않았습니다 — 한 번 직접 켜서 동의해 주세요' };
  if (o.recentDanger) return { start: false, reason: '최근 위험 조건으로 채굴기를 정지했습니다 — 원인을 확인한 뒤 직접 켜 주세요' };
  if (o.blocker) return { start: false, reason: o.blocker };
  return { start: true, reason: null };
}

export interface ControlDeps {
  /** 끝날 때까지 기다리는 명령 (셸 없이) */
  exec(cmd: Command): Promise<void>;
  /** 앱과 분리해 실행 (셸 없이). 프로세스가 실제로 뜨면 끝나고, 실행 실패면 예외 */
  spawnDetached(cmd: Command, cwd: string | undefined, hide: boolean): Promise<void>;
  /** 알려진 채굴기 프로세스 정지·확인. 실패 사유 또는 null */
  killMiners(): Promise<string | null>;
}

/** 켜기·끄기 실행부. 조건 확인(startBlocker)·동의·확인 대화상자는 호출부가 맡는다 */
export function createMinerControl(deps: ControlDeps) {
  return {
    async start(c: MinerControlConfig): Promise<string | null> {
      const s = startCommand(c);
      if (!s) return '켜기 방식이 설정되지 않았습니다';
      try {
        if (s.kind === 'spawn') await deps.spawnDetached(s.cmd, s.cwd, s.hide ?? true);
        else await deps.exec(s.cmd);
        return null;
      } catch (e) {
        return `켜기 실패: ${(e as Error).message}`;
      }
    },
    async stop(c: MinerControlConfig): Promise<string | null> {
      const cmd = stopCommand(c);
      let cmdErr: string | null = null;
      if (cmd) {
        try {
          await deps.exec(cmd);
        } catch (e) {
          // 작업이 이미 끝났거나 외부에서 실행한 경우도 실패로 나온다. 프로세스 정지로 계속 진행
          cmdErr = (e as Error).message;
        }
      }
      const killErr = await deps.killMiners();
      if (killErr) return cmdErr ? `${killErr} (정지 명령: ${cmdErr})` : killErr;
      return null;
    },
  };
}
