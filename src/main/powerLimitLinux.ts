// Linux 전력 제한: 앱은 비root. 최초 1회 pkexec 로 systemd oneshot 서비스 + polkit 규칙을 설치하고,
// 이후에는 JSON(데이터)만 쓰고 `systemctl start` 로 적용한다. 부팅 시 자동 재적용.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const LINUX_UNIT = 'crypthy-power-limit.service';
const UNIT_FILE = `/etc/systemd/system/${LINUX_UNIT}`;
const LOG_FILE = '/var/lib/crypthy/power-limit.log';

const SAFE_PATH = /^\/[A-Za-z0-9._/@+-]+$/;
const SAFE_USER = /^[a-z_][a-z0-9_-]{0,31}$/;

/** pkexec 인자 (설치 스크립트가 같은 규칙으로 다시 검사한다) */
export function buildInstallArgs(resourcesDir: string, configPath: string, user: string): string[] {
  if (!SAFE_PATH.test(configPath)) throw new Error(`지원하지 않는 문자가 있는 설정 경로: ${configPath}`);
  if (!SAFE_USER.test(user)) throw new Error(`지원하지 않는 사용자 이름: ${user}`);
  return ['/bin/sh', path.join(resourcesDir, 'linux', 'install-power-service.sh'), configPath, user];
}

function run(cmd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
  });
}

export const linuxPower = {
  async isRegistered(): Promise<boolean> {
    return fs.existsSync(UNIT_FILE);
  },
  async register(resourcesDir: string, configPath: string, user: string): Promise<void> {
    await run('pkexec', buildInstallArgs(resourcesDir, configPath, user));
  },
  /** polkit 규칙이 있으면 암호 없이, 없으면(구버전 polkit 등) pkexec 로 다시 시도 */
  async run(): Promise<void> {
    try {
      await run('systemctl', ['start', LINUX_UNIT], 30_000);
    } catch {
      await run('pkexec', ['systemctl', 'start', LINUX_UNIT], 120_000);
    }
  },
  readLog(): string | null {
    try {
      return fs.readFileSync(LOG_FILE, 'utf8').slice(0, 2000);
    } catch {
      return null;
    }
  },
};
