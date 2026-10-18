// 실행 중인 채굴기 프로세스 감지·정지 (Windows). 켜기는 minerControl(사용자가 구성한 작업·실행 파일)만, 자동 재시작은 없다.
import { execFile } from 'node:child_process';

/** `tasklist /fo csv /nh` 출력에서 이미지 이름·PID */
export function parseTasklist(out: string): { name: string; pid: number }[] {
  const rows: { name: string; pid: number }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) rows.push({ name: m[1], pid: Number(m[2]) });
  }
  return rows;
}

/** 실행 중인 프로세스 중 알려진 채굴기 이름 (알려진 목록의 표기로, 중복 제거) */
export function matchKnown(rows: { name: string }[], known: string[]): string[] {
  const running = new Set(rows.map((r) => r.name.toLowerCase()));
  return known.filter((k) => running.has(k.toLowerCase()));
}

function run(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    );
  });
}

export async function runningMiners(known: string[]): Promise<string[]> {
  return matchKnown(parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh'])), known);
}

/** taskkill 결과는 호출부가 runningMiners 로 다시 확인한다 (권한 부족 등으로 실패할 수 있음) */
export async function killMiner(exe: string): Promise<string | null> {
  try {
    await run('taskkill', ['/im', exe, '/f']);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
