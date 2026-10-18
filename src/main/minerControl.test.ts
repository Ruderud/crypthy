import { describe, expect, it } from 'vitest';
import type { MinerControlConfig } from '../shared/types';
import {
  autoStartDecision, controlProcessName, createMinerControl, decodeConsole, parseArgs, parseTaskStatus, parseTaskXml, quoteArg, spawnOptions, startBlocker,
  startCommand, stopCommand, unwrapConhost, validateControl, type Command,
} from './minerControl';

const cfg = (p: Partial<MinerControlConfig>): MinerControlConfig => ({ mode: 'none', taskName: '', unit: '', exe: '', args: '', confirmStop: true, hideWindow: true, ...p });
const SRB = 'C:\\Mining\\SRBMiner\\SRBMiner-MULTI.exe';

describe('argument parsing (no shell)', () => {
  it('splits on spaces, keeps quoted spaces, and passes shell metacharacters through as plain text', () => {
    expect(parseArgs('--algorithm pearlhash --pool prl.kryptex.network:8048 --wallet abc.rig1 --api-enable --api-port 21550')).toEqual([
      '--algorithm', 'pearlhash', '--pool', 'prl.kryptex.network:8048', '--wallet', 'abc.rig1', '--api-enable', '--api-port', '21550',
    ]);
    expect(parseArgs('--log-file "C:\\Mining logs\\srb.txt"  --x ""')).toEqual(['--log-file', 'C:\\Mining logs\\srb.txt', '--x', '']);
    expect(parseArgs('a & calc.exe | b > c $(rm -rf ~) `x`')).toEqual(['a', '&', 'calc.exe', '|', 'b', '>', 'c', '$(rm', '-rf', '~)', '`x`']);
    expect(parseArgs('"say \\"hi\\""')).toEqual(['say "hi"']);
  });

  it('rejects newlines, control characters and unbalanced quotes', () => {
    expect(() => parseArgs('a\nb')).toThrow();
    expect(() => parseArgs('a\0b')).toThrow();
    expect(() => parseArgs('"open')).toThrow();
  });
});

describe('start / stop commands', () => {
  it('Windows scheduled task: schtasks /Run and /End with the name as one argument', () => {
    const c = cfg({ mode: 'task', taskName: 'PearlMiner' });
    expect(validateControl(c, 'windows')).toBeNull();
    expect(startCommand(c)).toEqual({ kind: 'exec', cmd: { file: 'schtasks.exe', args: ['/Run', '/TN', 'PearlMiner'] } });
    expect(stopCommand(c)).toEqual({ file: 'schtasks.exe', args: ['/End', '/TN', 'PearlMiner'] });
    expect(validateControl(cfg({ mode: 'task', taskName: '\\Mining\\PearlMiner' }), 'windows')).toBeNull();
  });

  it('rejects task names that could be read as options or break quoting', () => {
    for (const bad of ['/F', '-x', 'a"b', 'a|b', 'a\nb', '', ' PearlMiner']) {
      expect(validateControl(cfg({ mode: 'task', taskName: bad }), 'windows')).not.toBeNull();
    }
    expect(validateControl(cfg({ mode: 'task', taskName: 'PearlMiner' }), 'linux')).not.toBeNull();
  });

  it('systemd --user: unit after -- so it can never be an option', () => {
    const c = cfg({ mode: 'systemd', unit: 'srbminer.service' });
    expect(validateControl(c, 'linux')).toBeNull();
    expect(startCommand(c)!.cmd).toEqual({ file: 'systemctl', args: ['--user', 'start', '--', 'srbminer.service'] });
    expect(stopCommand(c)).toEqual({ file: 'systemctl', args: ['--user', 'stop', '--', 'srbminer.service'] });
    for (const bad of ['--now', 'a b', 'a;b', '$(x)', '']) expect(validateControl(cfg({ mode: 'systemd', unit: bad }), 'linux')).not.toBeNull();
  });

  it('direct: absolute .exe on Windows, args as an array, cwd = the miner folder, stop by process', () => {
    const c = cfg({ mode: 'direct', exe: SRB, args: '--algorithm pearlhash --api-enable' });
    expect(validateControl(c, 'windows')).toBeNull();
    expect(startCommand(c)).toEqual({ kind: 'spawn', cmd: { file: SRB, args: ['--algorithm', 'pearlhash', '--api-enable'] }, cwd: 'C:\\Mining\\SRBMiner', hide: true });
    expect(stopCommand(c)).toBeNull();
    expect(controlProcessName(c, 'windows')).toBe('SRBMiner-MULTI.exe');
    expect(validateControl(cfg({ mode: 'direct', exe: 'SRBMiner-MULTI.exe' }), 'windows')).not.toBeNull();
    expect(validateControl(cfg({ mode: 'direct', exe: 'C:\\Mining\\start.bat' }), 'windows')).not.toBeNull();
    expect(validateControl(cfg({ mode: 'direct', exe: '/opt/srb/SRBMiner-MULTI' }), 'linux')).toBeNull();
    expect(validateControl(cfg({ mode: 'direct', exe: SRB, args: 'a\r\nb' }), 'windows')).not.toBeNull();
  });
});

describe('process names', () => {
  it('never uses a shell or interpreter as the miner name (it would match and kill unrelated windows)', () => {
    for (const exe of ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '/usr/bin/python3', '/bin/bash']) {
      const c = cfg({ mode: 'task', taskName: 'PearlMiner', exe });
      expect(controlProcessName(c, exe.startsWith('/') ? 'linux' : 'windows')).toBeNull();
      expect(validateControl(c, 'windows')).toMatch(/셸·인터프리터/);
    }
    expect(controlProcessName(cfg({ mode: 'task', taskName: 'PearlMiner', exe: SRB }), 'windows')).toBe('SRBMiner-MULTI.exe');
  });
});

describe('quiet start and automatic start', () => {
  it('direct start hides the console window unless turned off', () => {
    expect(startCommand(cfg({ mode: 'direct', exe: SRB }))?.hide).toBe(true);
    expect(startCommand(cfg({ mode: 'direct', exe: SRB, hideWindow: false }))?.hide).toBe(false);
    expect(spawnOptions('C:\\Mining', true)).toEqual({ cwd: 'C:\\Mining', detached: true, stdio: ['ignore', 'ignore', 'ignore'], shell: false, windowsHide: true });
    // 출력은 로그 파일로 (창 없이, "채굴 창 보기"에서만)
    expect(spawnOptions(undefined, true, 7).stdio).toEqual(['ignore', 7, 7]);
  });

  it('starts automatically only when enabled, consented, no recent danger stop and nothing blocks it', () => {
    const ok = { enabled: true, consented: true, recentDanger: false, blocker: null };
    expect(autoStartDecision(ok)).toEqual({ start: true, reason: null });
    expect(autoStartDecision({ ...ok, enabled: false })).toEqual({ start: false, reason: null });
    expect(autoStartDecision({ ...ok, consented: false }).reason).toMatch(/동의/);
    expect(autoStartDecision({ ...ok, recentDanger: true }).reason).toMatch(/위험/);
    // 예약 작업이 먼저 띄운 채굴기 → 두 번째를 띄우지 않음 / 안전 보류
    expect(autoStartDecision({ ...ok, blocker: '채굴기가 이미 실행 중입니다' })).toEqual({ start: false, reason: '채굴기가 이미 실행 중입니다' });
    expect(autoStartDecision({ ...ok, blocker: '안전 보류 중: RTX 5090(팬 정지)' }).start).toBe(false);
  });
});

describe('switching a scheduled task to the executable method', () => {
  it('unwraps a conhost --headless wrapper to the real miner and its arguments', () => {
    expect(unwrapConhost('C:\\Windows\\System32\\conhost.exe', `--headless "${SRB}" --algorithm pearlhash --pool "prl.kryptex.network:8048"`)).toEqual({
      exe: SRB,
      args: '--algorithm pearlhash --pool prl.kryptex.network:8048',
    });
    expect(unwrapConhost('conhost.exe', '--headless --width 120 "C:\\My Miners\\srb.exe" --log "C:\\a b\\x.txt"')).toEqual({
      exe: 'C:\\My Miners\\srb.exe',
      args: '--log "C:\\a b\\x.txt"',
    });
    expect(unwrapConhost(SRB, '--a')).toEqual({ exe: SRB, args: '--a' });
    expect(unwrapConhost('conhost.exe', '--headless')).toEqual({ exe: 'conhost.exe', args: '--headless' });
  });

  it('quoted arguments split back to the same list', () => {
    const list = ['--log', 'C:\\a b\\x.txt', 'say "hi"', ''];
    expect(parseArgs(list.map(quoteArg).join(' '))).toEqual(list);
  });

  it('reads the task status from schtasks CSV (any language)', () => {
    expect(parseTaskStatus('"\\PearlMiner","N/A","Running"\r\n')).toBe('Running');
    expect(parseTaskStatus('"\\PearlMiner","해당 없음","사용 안 함"')).toBe('사용 안 함');
    expect(parseTaskStatus('')).toBeNull();
  });
});

describe('importing a scheduled task', () => {
  it('reads Command and Arguments from schtasks /XML, unescaping XML entities and outer quotes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task><Actions Context="Author"><Exec>
  <Command>"${SRB}"</Command>
  <Arguments>--algorithm pearlhash --pool prl.kryptex.network:8048 --wallet abc.rig &amp;&amp; --api-enable</Arguments>
  <WorkingDirectory>C:\\Mining\\SRBMiner</WorkingDirectory>
</Exec></Actions></Task>`;
    expect(parseTaskXml(xml)).toEqual({ exe: SRB, args: '--algorithm pearlhash --pool prl.kryptex.network:8048 --wallet abc.rig && --api-enable' });
    expect(parseTaskXml('<Task><Actions><ComHandler/></Actions></Task>')).toBeNull();
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
    expect(parseTaskXml(decodeConsole(utf16))?.exe).toBe(SRB);
  });
});

describe('start conditions', () => {
  const base = { config: cfg({ mode: 'task', taskName: 'PearlMiner' }), platform: 'windows' as const, running: false, holds: [] as string[], starting: false };

  it('allows start only when configured, nothing is running and no safety hold remains', () => {
    expect(startBlocker(base)).toBeNull();
    expect(startBlocker({ ...base, config: cfg({}) })).toMatch(/방식/);
    expect(startBlocker({ ...base, running: true })).toMatch(/이미 실행 중/);
    expect(startBlocker({ ...base, starting: true })).toMatch(/켜는 중/);
    expect(startBlocker({ ...base, procsUnknown: true })).toMatch(/프로세스 목록/);
  });

  it('after a danger stop the hold blocks start until the user clears it', () => {
    expect(startBlocker({ ...base, holds: ['RTX 5090(팬 정지)'] })).toMatch(/안전 보류 중: RTX 5090\(팬 정지\)/);
  });
});

describe('controller', () => {
  const fake = (killErr: string | null = null, execFail = false) => {
    const calls: string[] = [];
    const deps = {
      exec: async (c: Command) => {
        calls.push(`exec ${c.file} ${c.args.join(' ')}`);
        if (execFail) throw new Error('ERROR: The task is not running.');
      },
      spawnDetached: async (c: Command, cwd: string | undefined, hide: boolean) => void calls.push(`spawn ${c.file} ${c.args.join(' ')} @${cwd}${hide ? ' hide' : ''}`),
      killMiners: async () => {
        calls.push('kill');
        return killErr;
      },
    };
    return { calls, ctl: createMinerControl(deps) };
  };

  it('stop runs the stop command then stops the miner process; it never starts anything', async () => {
    const { calls, ctl } = fake();
    expect(await ctl.stop(cfg({ mode: 'task', taskName: 'PearlMiner' }))).toBeNull();
    expect(calls).toEqual(['exec schtasks.exe /End /TN PearlMiner', 'kill']);
  });

  it('a failed /End (task already ended, miner started elsewhere) still stops the process', async () => {
    const { calls, ctl } = fake(null, true);
    expect(await ctl.stop(cfg({ mode: 'task', taskName: 'PearlMiner' }))).toBeNull();
    expect(calls.at(-1)).toBe('kill');
  });

  it('reports a process that cannot be stopped (e.g. started as administrator)', async () => {
    const { ctl } = fake('관리자 권한으로 실행된 채굴기는 앱이 끌 수 없습니다');
    expect(await ctl.stop(cfg({ mode: 'direct', exe: SRB }))).toMatch(/관리자 권한/);
  });

  it('direct start spawns detached without a shell', async () => {
    const { calls, ctl } = fake();
    expect(await ctl.start(cfg({ mode: 'direct', exe: SRB, args: '--a "b c"' }))).toBeNull();
    expect(calls).toEqual([`spawn ${SRB} --a b c @C:\\Mining\\SRBMiner hide`]);
  });
});
