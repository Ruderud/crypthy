// 공유 장부 (듀얼부팅처럼 같은 PC 의 여러 OS 가 번갈아 쓰는 PnL).
//
// <공유 폴더>/crypthy/
//   pnl/events-<instanceId>.jsonl  각 인스턴스가 자기 파일에만 덧붙인다. 다른 인스턴스 파일은 읽기만
//   pool-state.json                풀 누적 기준점(마지막 누적치·지급 합계·본 지급 id). 실행 중인 인스턴스가 갱신
//   shared-settings.json           기기와 무관한 설정(코인·지갑·풀·수익 설정)
//
// 두 인스턴스가 동시에 돌지 않는다고 가정한다(같은 PC). 순서는 시계 대신 세대 번호(gen)로 판단한다
// (듀얼부팅은 Windows 와 Linux 의 하드웨어 시계 해석이 달라 부팅 직후 시각이 몇 시간 어긋날 수 있다).
// FAT32 를 고려해: 파일 이름은 영문·숫자·-_ 만, 잠금 없음, 덮어쓰기는 임시 파일 → fsync → rename,
// 덧붙이기는 줄 단위 + fsync, 깨진 줄은 읽을 때 건너뛴다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { eventKey, parseEventLine, readEvents, type PnlEvent } from './pnl';
import type { Ledger } from './profit';

export const SHARED_SUBDIR = 'crypthy';
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const EVENTS_RE = /^events-([A-Za-z0-9_-]{4,40})\.jsonl$/;

export const sharedRoot = (dir: string) => path.join(dir, SHARED_SUBDIR);
export const sharedEventsFile = (root: string, id: string) => path.join(root, 'pnl', `events-${id}.jsonl`);

/** 이 데이터 폴더의 인스턴스 id (처음 한 번 만들고 로컬에 둔다). 예: windows-3f9a1c */
export function ensureInstanceId(dataDir: string, platform: string): string {
  const f = path.join(dataDir, 'instance.json');
  try {
    const id = (JSON.parse(fs.readFileSync(f, 'utf8')) as { id?: unknown }).id;
    if (typeof id === 'string' && ID_RE.test(id)) return id;
  } catch {
    // 없으면 만든다
  }
  const id = `${platform.replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'pc'}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify({ id, createdAt: Date.now() })}\n`);
  return id;
}

/** 덮어쓰기: 임시 파일에 쓰고 fsync 한 뒤 rename (중간에 꺼져도 이전 내용 또는 새 내용) */
export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** 줄 덧붙이기 + fsync */
export function appendLines(file: string, lines: string[]): void {
  if (!lines.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, lines.map((l) => `${l}\n`).join(''));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 로컬 이벤트 로그(source of truth) 중 공유 폴더의 내 파일에 아직 없는 것을 덧붙인다 (전체 비교, 테스트·첫 동기화용).
 * 공유 폴더가 없던 동안 쌓인 이벤트도 이때 반영된다. 처음 켤 때는 기존 로컬 장부 전체가 여기서 옮겨진다.
 */
export function syncOwnEvents(localFile: string, ownShared: string): number {
  const have = new Set(readEvents(ownShared).map(eventKey));
  const missing = readEvents(localFile).filter((ev) => !have.has(eventKey(ev)));
  appendLines(ownShared, missing.map((ev) => JSON.stringify(ev)));
  return missing.length;
}

/**
 * 덧붙이기만 하는 파일을 이어 읽는다: 지난번 이후 늘어난 바이트만 읽고, 끝의 덜 쓴 줄은 다음 번으로 미룬다.
 * 파일이 작아지면(회전·교체) 처음부터 다시 읽는다. 큰 장부를 1분마다 통째로 읽지 않으려는 것.
 */
export function createTailReader() {
  const cache = new Map<string, { size: number; rest: Buffer; events: PnlEvent[] }>();
  return (file: string): PnlEvent[] => {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      cache.delete(file);
      return [];
    }
    let c = cache.get(file);
    if (!c || size < c.size) c = { size: 0, rest: Buffer.alloc(0), events: [] };
    if (size > c.size) {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - c.size);
      try {
        fs.readSync(fd, buf, 0, buf.length, c.size);
      } finally {
        fs.closeSync(fd);
      }
      const all = Buffer.concat([c.rest, buf]);
      const end = all.lastIndexOf(0x0a);
      const done = end >= 0 ? all.subarray(0, end) : Buffer.alloc(0);
      c.rest = end >= 0 ? Buffer.from(all.subarray(end + 1)) : all;
      for (const line of done.toString('utf8').split('\n')) {
        const ev = parseEventLine(line);
        if (ev) c.events.push(ev);
      }
      c.size = size;
    }
    cache.set(file, c);
    return c.events;
  };
}

/** 로컬 로그 → 공유 폴더의 내 파일 미러. 처음 한 번만 전체를 비교하고 이후로는 늘어난 줄만 확인한다 */
export function createMirror(localFile: string, ownShared: string) {
  const tail = createTailReader();
  let keys: Set<string> | null = null;
  let checked = 0;
  return (): number => {
    let missing: PnlEvent[];
    if (!keys) {
      keys = new Set(readEvents(ownShared).map(eventKey));
      const have = keys;
      missing = readEvents(localFile).filter((ev) => !have.has(eventKey(ev)));
      checked = tail(localFile).length;
    } else {
      const local = tail(localFile);
      if (local.length < checked) checked = 0;
      missing = local.slice(checked).filter((ev) => !keys!.has(eventKey(ev)));
      checked = local.length;
    }
    appendLines(ownShared, missing.map((ev) => JSON.stringify(ev)));
    for (const ev of missing) keys.add(eventKey(ev));
    return missing.length;
  };
}

/** 공유 폴더의 모든 인스턴스 이벤트 (파일별). read 를 주면 이어 읽기 */
export function readSharedEvents(root: string, read: (file: string) => PnlEvent[] = readEvents): { src: string; events: PnlEvent[] }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(root, 'pnl'));
  } catch {
    return [];
  }
  return names
    .map((n) => EVENTS_RE.exec(n)?.[1])
    .filter((id): id is string => !!id)
    .sort()
    .map((id) => ({ src: id, events: read(sharedEventsFile(root, id)) }));
}

/** 공유 이벤트 파일들의 크기·수정 시각 (바뀌었을 때만 다시 계산하려고) */
export function sharedEventsStamp(root: string): string {
  try {
    return fs
      .readdirSync(path.join(root, 'pnl'))
      .filter((n) => EVENTS_RE.test(n))
      .sort()
      .map((n) => {
        const st = fs.statSync(path.join(root, 'pnl', n));
        return `${n}:${st.size}:${st.mtimeMs}`;
      })
      .join('|');
  } catch {
    return '';
  }
}

// ---- 풀 누적 기준점 ----

export interface PoolState {
  /** 세대 번호: 쓸 때마다 1씩 커진다 */
  gen: number;
  by: string;
  /** 이 기준점의 코인 (다른 코인의 기준점은 받아들이지 않는다) */
  coin: string;
  lastTotal: number | null;
  paidTotal: number;
  seenPayouts: string[];
  /** 마지막 풀 증가 시각 (다음 증가분을 날짜에 나눌 때 시작점) */
  lastMinedAt: number | null;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function readPoolState(root: string): PoolState | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'pool-state.json'), 'utf8')) as Partial<PoolState>;
    if (!Number.isInteger(r.gen) || (r.gen as number) < 1) return null;
    return {
      gen: r.gen as number,
      by: typeof r.by === 'string' ? r.by : '',
      coin: typeof r.coin === 'string' ? r.coin : '',
      lastTotal: typeof r.lastTotal === 'number' && Number.isFinite(r.lastTotal) ? r.lastTotal : null,
      paidTotal: num(r.paidTotal),
      seenPayouts: Array.isArray(r.seenPayouts) ? r.seenPayouts.filter((k): k is string => typeof k === 'string') : [],
      lastMinedAt: typeof r.lastMinedAt === 'number' && Number.isFinite(r.lastMinedAt) ? r.lastMinedAt : null,
    };
  } catch {
    return null;
  }
}

export function writePoolState(root: string, s: PoolState): void {
  writeAtomic(path.join(root, 'pool-state.json'), `${JSON.stringify(s, null, 2)}\n`);
}

/**
 * 다른 인스턴스가 더 최근에(세대 번호가 더 크게) 갱신한 기준점을 받아들인다.
 * 그 사이 쌓인 채굴량은 그 인스턴스가 이미 기록했으므로, 이 인스턴스는 그 기준점 이후 증가분만 기록한다(이중 계상 없음).
 * 지급 id 는 합집합. 누적치는 같은 기준이므로 큰 값(high-water mark).
 */
export function adoptPoolState(l: Ledger, s: PoolState): Ledger {
  const seen = [...new Set([...l.seenPayouts, ...s.seenPayouts])];
  return {
    ...l,
    lastTotal: s.lastTotal === null ? l.lastTotal : l.lastTotal === null ? s.lastTotal : Math.max(l.lastTotal, s.lastTotal),
    paidTotal: Math.max(l.paidTotal, s.paidTotal),
    seenPayouts: seen.slice(-300),
    // 다른 인스턴스가 돌던 동안의 전력은 그쪽이 기록했다: 이 인스턴스의 대기 전력은 버린다
    pendingKwh: 0,
    pendingMs: 0,
  };
}

export const poolStateOf = (l: Ledger, coin: string, lastMinedAt: number | null, gen: number, by: string): PoolState => ({
  gen, by, coin, lastTotal: l.lastTotal, paidTotal: l.paidTotal, seenPayouts: l.seenPayouts.slice(-300), lastMinedAt,
});

// ---- 공유 설정 (기기와 무관한 것만) ----

export const SHARED_SETTING_KEYS = ['coin', 'wallet', 'pool', 'profit'] as const;
export type SharedSettings = Pick<Settings, (typeof SHARED_SETTING_KEYS)[number]> & { gen: number; by: string };

export function readSharedSettings(root: string): SharedSettings | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(root, 'shared-settings.json'), 'utf8')) as Partial<SharedSettings>;
    if (!Number.isInteger(r.gen) || (r.gen as number) < 1) return null;
    return r as SharedSettings;
  } catch {
    return null;
  }
}

export function sharedSettingsOf(s: Settings, gen: number, by: string): SharedSettings {
  return { gen, by, coin: s.coin, wallet: s.wallet, pool: s.pool, profit: s.profit };
}

export function writeSharedSettings(root: string, s: SharedSettings): void {
  writeAtomic(path.join(root, 'shared-settings.json'), `${JSON.stringify(s, null, 2)}\n`);
}

/** 로컬 동기화 상태: 마지막으로 받아들인·쓴 세대 번호 */
export interface SyncState {
  poolGen: number;
  settingsGen: number;
  /** 한 번 연결해 crypthy/ 를 만든 공유 폴더. 이후 crypthy/ 가 없으면 만들지 않고 "연결 안 됨"으로 본다 (마운트 안 된 빈 마운트 지점) */
  rootDir?: string;
  /** 연결이 끊긴 동안 바꾼 공유 설정 (다시 보이면 올린다) */
  settingsDirty?: boolean;
}
