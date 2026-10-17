// Linux 프로세스 감지·정지 (/proc). Crypthy 는 채굴기를 시작하지 않는다.
//
// 절대 원칙: 컨테이너 안의 프로세스(Vast 고객 워크로드 등 docker/containerd/podman/lxc 하위)는
// 채굴기로 인식하지도, 정지하지도 않는다. 판별이 불확실하면 컨테이너로 본다(정지 대상에서 제외).
import fs from 'node:fs';
import path from 'node:path';

export interface ProcInfo {
  pid: number;
  ppid: number;
  comm: string;
  /** argv (cmdline 의 \0 구분) */
  argv: string[];
  cgroup: string;
  /** 이 앱과 같은 PID 네임스페이스인지. 읽을 수 없으면 null */
  samePidNs: boolean | null;
}

/** /proc/<pid>/stat → pid, comm, ppid. comm 은 괄호 안에 공백·괄호를 포함할 수 있어 마지막 ')' 기준으로 자른다 */
export function parseStat(text: string): { pid: number; comm: string; ppid: number } | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const pid = Number.parseInt(text.slice(0, open).trim(), 10);
  const rest = text.slice(close + 1).trim().split(/\s+/);
  const ppid = Number.parseInt(rest[1] ?? '', 10);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return null;
  return { pid, comm: text.slice(open + 1, close), ppid };
}

const CONTAINER_CGROUP = /(docker|containerd|cri-containerd|kubepods|libpod|podman|lxc|lxd|machine\.slice|garden|actions_job)/i;

/** cgroup 경로에 컨테이너 런타임 흔적이 있으면 true */
export function isContainerCgroup(cgroup: string): boolean {
  return cgroup.split('\n').some((line) => CONTAINER_CGROUP.test(line.split(':').slice(2).join(':')));
}

/**
 * 조상 중에 컨테이너 런타임이 있으면 그 아래는 전부 컨테이너 워크로드로 본다.
 * comm 은 커널이 15자로 자른다 (containerd-shim-runc-v2 → containerd-shim).
 * kaalia: Vast.ai 호스트 데몬으로 알려진 이름(미확인) — 예외 목록이라 넣어 두어도 오탐 위험이 없다.
 */
export const CONTAINER_PARENTS = new Set(['containerd-shim', 'containerd', 'dockerd', 'docker-proxy', 'runc', 'crun', 'conmon', 'podman', 'lxc-start', 'lxd', 'kaalia']);

export function isContainerized(p: ProcInfo, byPid: Map<number, ProcInfo>): boolean {
  if (p.samePidNs !== true) return true; // 다른 PID 네임스페이스이거나 확인 불가 → 컨테이너로 간주
  if (isContainerCgroup(p.cgroup)) return true;
  let cur = byPid.get(p.ppid);
  for (let depth = 0; cur && depth < 64; depth++) {
    if (CONTAINER_PARENTS.has(cur.comm) || isContainerCgroup(cur.cgroup)) return true;
    cur = cur.ppid === cur.pid ? undefined : byPid.get(cur.ppid);
  }
  return false;
}

/** 채굴기 명령줄 표지: 풀·지갑·알고리즘 인자. 같은 이름의 다른 도구(예: Foundry 의 forge)를 거르기 위함 */
const MINER_FLAG = /^--(pool|wallet|algo|algorithm|coin|worker|user)(=|$)/i;
const POOL_LIKE = /(stratum\+(tcp|ssl|tls):\/\/|\.kryptex\.network|^[a-z0-9-]+(\.[a-z0-9-]+)+:\d{2,5}$)/i;

export function looksLikeMiner(argv: string[]): boolean {
  return argv.slice(1).some((a) => MINER_FLAG.test(a) || POOL_LIKE.test(a));
}

/** 실행 파일 이름: argv[0] 의 basename (comm 은 15자로 잘리므로 보조로만) */
export const exeName = (p: ProcInfo) => path.posix.basename(p.argv[0] || p.comm);

/** 알려진 이름 + 채굴기 인자 + 컨테이너 밖 → 정지 후보. 반환: 이름별 PID */
export function findMiners(procs: ProcInfo[], known: string[]): Map<string, number[]> {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const out = new Map<string, number[]>();
  for (const p of procs) {
    const name = known.find((k) => k === exeName(p) || k === p.comm);
    if (!name || !looksLikeMiner(p.argv) || isContainerized(p, byPid)) continue;
    out.set(name, [...(out.get(name) ?? []), p.pid]);
  }
  return out;
}

// ---- /proc 읽기 ----

const MAX_PROCS = 8192;

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function scanProc(root = '/proc'): ProcInfo[] {
  let selfNs: string | null = null;
  try {
    selfNs = fs.readlinkSync(`${root}/self/ns/pid`);
  } catch {
    selfNs = null;
  }
  const procs: ProcInfo[] = [];
  for (const entry of fs.readdirSync(root).slice(0, MAX_PROCS)) {
    if (!/^\d+$/.test(entry)) continue;
    const st = parseStat(read(`${root}/${entry}/stat`) ?? '');
    if (!st) continue;
    let ns: string | null = null;
    try {
      ns = fs.readlinkSync(`${root}/${entry}/ns/pid`);
    } catch {
      ns = null;
    }
    procs.push({
      ...st,
      argv: (read(`${root}/${entry}/cmdline`) ?? '').split('\0').filter(Boolean).slice(0, 64),
      cgroup: (read(`${root}/${entry}/cgroup`) ?? '').slice(0, 4096),
      samePidNs: ns === null || selfNs === null ? null : ns === selfNs,
    });
  }
  return procs;
}

export function runningMinersLinux(known: string[]): string[] {
  return [...findMiners(scanProc(), known).keys()];
}

/** SIGTERM → 3초 뒤에도 살아 있으면 SIGKILL. 다른 사용자의 프로세스는 EPERM 으로 실패한다 */
export async function killMinerLinux(name: string, known: string[]): Promise<string | null> {
  const pids = findMiners(scanProc(), known).get(name) ?? [];
  const errors: string[] = [];
  const send = (pid: number, sig: NodeJS.Signals) => {
    try {
      process.kill(pid, sig);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') errors.push(`${pid}: ${code ?? (e as Error).message}`);
    }
  };
  pids.forEach((pid) => send(pid, 'SIGTERM'));
  await new Promise((r) => setTimeout(r, 3000));
  const left = findMiners(scanProc(), known).get(name) ?? [];
  left.filter((pid) => pids.includes(pid)).forEach((pid) => send(pid, 'SIGKILL'));
  return errors.length ? errors.join(' · ') : null;
}
