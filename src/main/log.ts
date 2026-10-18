// 파일 로그 (%APPDATA%\Crypthy\logs\main.log). 업데이트·종료처럼 화면에 남지 않는 과정을 나중에 확인하려는 용도.
// 상한(maxBytes)을 넘으면 main.old.log 로 한 번 회전한다. 쓰기 실패는 무시한다(로그 때문에 앱이 멈추지 않게).
// 비밀값은 넘기지 않는다: 호출부는 지갑·토큰 같은 값을 메시지에 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export const LOG_MAX_BYTES = 1024 * 1024;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

const fmt = (a: unknown) => (a instanceof Error ? `${a.message}${a.stack ? `\n${a.stack}` : ''}` : typeof a === 'string' ? a : JSON.stringify(a));

export function createFileLogger(file: string, maxBytes = LOG_MAX_BYTES, now: () => Date = () => new Date()): Logger {
  const write = (level: string, args: unknown[]) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const line = `${now().toISOString()} [${level}] ${args.map(fmt).join(' ')}\n`;
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
      if (size > 0 && size + line.length > maxBytes) fs.renameSync(file, file.replace(/\.log$/, '.old.log'));
      fs.appendFileSync(file, line);
    } catch {
      // 로그 쓰기 실패는 무시
    }
  };
  return {
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    // electron-updater 의 debug 는 양이 많아 남기지 않는다
    debug: () => undefined,
  };
}
