// Linux 로그인 시 자동 실행: ~/.config/autostart/crypthy.desktop (XDG Autostart)
// Windows 는 Electron 의 setLoginItemSettings 를 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import { posix as path } from 'node:path';

/** Desktop Entry Exec 값 규칙에 맞게 따옴표로 감싸고 " ` $ \ 를 이스케이프 */
export function quoteExec(p: string): string {
  if (/[\n\r]/.test(p)) throw new Error('줄바꿈이 있는 경로는 쓸 수 없습니다');
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`;
}

export function buildDesktopEntry(execPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Crypthy',
    'Comment=Coin mining hub and PC manager',
    `Exec=${quoteExec(execPath)} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function autostartFile(home = os.homedir()): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'crypthy.desktop');
}

/** AppImage 는 마운트 경로가 매번 바뀌므로 APPIMAGE(원본 파일) 경로를 쓴다 */
export function setLinuxAutostart(enabled: boolean, execPath = process.env.APPIMAGE || process.execPath, file = autostartFile()): void {
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildDesktopEntry(execPath), { mode: 0o644 });
}
