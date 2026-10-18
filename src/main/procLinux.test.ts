import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMiners, isContainerCgroup, isContainerized, looksLikeMiner, parseStat, scanProc, type ProcInfo } from './procLinux';

const KNOWN = ['SRBMiner-MULTI', 'peakminer', 'forge'];
const HOST_CG = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-gnome-terminal.scope\n';
const proc = (o: Partial<ProcInfo> & { pid: number }): ProcInfo => ({ ppid: 1, comm: 'x', argv: ['x'], cgroup: HOST_CG, samePidNs: true, ...o });
const srb = (pid: number, extra: Partial<ProcInfo> = {}) =>
  proc({ pid, comm: 'SRBMiner-MULTI', argv: ['./SRBMiner-MULTI', '--algorithm', 'pearlhash', '--pool', 'prl.kryptex.network:8048', '--wallet', 'prl1x.w'], ...extra });

describe('parseStat', () => {
  it('handles comm with spaces and parentheses', () => {
    expect(parseStat('1234 (Web Content (x)) S 99 1234 1234 0 -1')).toEqual({ pid: 1234, comm: 'Web Content (x)', ppid: 99 });
    expect(parseStat('garbage')).toBeNull();
  });
});

describe('container detection', () => {
  it('recognizes docker / containerd / kubepods / podman cgroups', () => {
    for (const cg of [
      '0::/system.slice/docker-3f2a9c1b7e4d.scope\n',
      '12:memory:/docker/3f2a9c1b7e4d\n',
      '0::/kubepods.slice/kubepods-besteffort.slice/cri-containerd-ab12.scope\n',
      '0::/machine.slice/libpod-ab12.scope\n',
      '0::/lxc.payload.c1\n',
    ]) expect(isContainerCgroup(cg), cg).toBe(true);
    expect(isContainerCgroup(HOST_CG)).toBe(false);
  });

  it('treats a process under containerd-shim as a container workload even with a host-looking cgroup', () => {
    const shim = proc({ pid: 50, comm: 'containerd-shim', ppid: 1 });
    const child = srb(51, { ppid: 50 });
    const map = new Map([shim, child].map((p) => [p.pid, p]));
    expect(isContainerized(child, map)).toBe(true);
  });

  it('treats other or unknown PID namespaces as containers', () => {
    expect(isContainerized(srb(10, { samePidNs: false }), new Map())).toBe(true);
    expect(isContainerized(srb(10, { samePidNs: null }), new Map())).toBe(true);
    expect(isContainerized(srb(10), new Map())).toBe(false);
  });
});

describe('looksLikeMiner', () => {
  it('requires pool / wallet / algorithm style arguments', () => {
    expect(looksLikeMiner(['./SRBMiner-MULTI', '--algorithm', 'pearlhash'])).toBe(true);
    expect(looksLikeMiner(['forge', '--algorithm=pearl', 'stratum+tcp://prl.kryptex.network:7048'])).toBe(true);
    expect(looksLikeMiner(['peakminer', '--coin', 'pearl'])).toBe(true);
  });
  it('ignores same-named developer tools (Foundry forge)', () => {
    expect(looksLikeMiner(['forge', 'build', '-w'])).toBe(false);
    expect(looksLikeMiner(['forge', 'test', '--fork-url', 'https://rpc.example.org'])).toBe(false);
    expect(looksLikeMiner(['forge'])).toBe(false);
  });
});

describe('findMiners', () => {
  it('a miner the user configured for on/off is found by name even when started with only a config file', () => {
    const p = proc({ pid: 7, comm: 'SRBMiner-MULTI', argv: ['/opt/srb/SRBMiner-MULTI', '--config-file', 'pearl.json'] });
    expect(findMiners([p], KNOWN).size).toBe(0);
    expect([...findMiners([p], KNOWN, ['SRBMiner-MULTI']).entries()]).toEqual([['SRBMiner-MULTI', [7]]]);
    // 컨테이너 안이면 지정한 이름이어도 건드리지 않는다
    expect(findMiners([{ ...p, cgroup: '0::/system.slice/docker-3f2a.scope\n' }], KNOWN, ['SRBMiner-MULTI']).size).toBe(0);
  });

  it('returns host miners only — never Vast/docker customer containers', () => {
    const procs = [
      srb(100),
      // Vast 고객 컨테이너 안의 같은 이름 채굴기: cgroup 으로 제외
      srb(200, { cgroup: '0::/system.slice/docker-9a8b7c6d5e4f.scope\n' }),
      // containerd-shim 아래: 조상으로 제외
      proc({ pid: 300, comm: 'containerd-shim', ppid: 1 }),
      srb(301, { ppid: 300 }),
      // 다른 PID 네임스페이스: 제외
      srb(400, { samePidNs: false }),
      // 이름만 같은 개발 도구: 제외
      proc({ pid: 500, comm: 'forge', argv: ['/home/u/.foundry/bin/forge', 'build'] }),
      // argv[0] 기준 이름 (comm 은 15자로 잘림)
      proc({ pid: 600, comm: 'peakminer', argv: ['/opt/pm/peakminer', '--coin', 'pearl', '--pool', 'prl.kryptex.network:7048'] }),
    ];
    expect([...findMiners(procs, KNOWN).entries()]).toEqual([
      ['SRBMiner-MULTI', [100]],
      ['peakminer', [600]],
    ]);
  });

  it('ignores unknown names', () => {
    expect(findMiners([proc({ pid: 1, comm: 'xmrig', argv: ['xmrig', '--pool', 'x.y:1'] })], KNOWN).size).toBe(0);
  });
});

describe('scanProc', () => {
  it('reads a fake /proc tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-proc-'));
    const mk = (pid: string, stat: string, cmdline: string[], cgroup: string) => {
      fs.mkdirSync(path.join(root, pid, 'ns'), { recursive: true });
      fs.writeFileSync(path.join(root, pid, 'stat'), stat);
      fs.writeFileSync(path.join(root, pid, 'cmdline'), cmdline.join('\0') + '\0');
      fs.writeFileSync(path.join(root, pid, 'cgroup'), cgroup);
    };
    mk('42', '42 (SRBMiner-MULTI) S 1 42 42', ['./SRBMiner-MULTI', '--pool', 'prl.kryptex.network:8048'], HOST_CG);
    fs.mkdirSync(path.join(root, 'self'));
    fs.writeFileSync(path.join(root, 'notapid'), '');
    const procs = scanProc(root);
    expect(procs).toHaveLength(1);
    expect(procs[0]).toMatchObject({ pid: 42, comm: 'SRBMiner-MULTI', ppid: 1, argv: ['./SRBMiner-MULTI', '--pool', 'prl.kryptex.network:8048'] });
    // ns 링크를 읽을 수 없으면 null → 컨테이너로 간주되어 정지 대상이 아니다
    expect(procs[0].samePidNs).toBeNull();
    expect(findMiners(procs, KNOWN).size).toBe(0);
    fs.rmSync(root, { recursive: true });
  });
});
