import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildInstallArgs } from './powerLimitLinux';

const LINUX_DIR = path.join(__dirname, '../../resources/linux');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const isWin = process.platform === 'win32';

describe('buildInstallArgs', () => {
  it('runs the bundled installer through /bin/sh with config path and user', () => {
    expect(buildInstallArgs('/opt/Crypthy/resources', '/home/u/.config/Crypthy/power-limits.json', 'u')).toEqual([
      '/bin/sh', '/opt/Crypthy/resources/linux/install-power-service.sh', '/home/u/.config/Crypthy/power-limits.json', 'u',
    ]);
  });
  it('rejects paths and users that could break the unit file or polkit rule', () => {
    expect(() => buildInstallArgs('/r', '/home/u/my config.json', 'u')).toThrow();
    expect(() => buildInstallArgs('/r', '/home/u/a"b.json', 'u')).toThrow();
    expect(() => buildInstallArgs('/r', 'relative.json', 'u')).toThrow();
    expect(() => buildInstallArgs('/r', '/home/u/c.json', 'root"; x')).toThrow();
  });
});

describe.skipIf(isWin)('install-power-service.sh', () => {
  it('is valid POSIX sh and refuses bad input before touching the system', () => {
    execFileSync('sh', ['-n', path.join(LINUX_DIR, 'install-power-service.sh')]);
    const r = spawnSync('sh', [path.join(LINUX_DIR, 'install-power-service.sh'), 'relative.json', 'u']);
    expect(r.status).toBe(2);
    const r2 = spawnSync('sh', [path.join(LINUX_DIR, 'install-power-service.sh'), '/tmp/x.json', 'Bad User']);
    expect(r2.status).toBe(2);
  });
});

describe.skipIf(!hasPython)('apply_power_limits.py (--dry-run)', () => {
  const runDry = (cfg: unknown) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-pl-'));
    const file = path.join(dir, 'power-limits.json');
    fs.writeFileSync(file, typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    const out = execFileSync('python3', [path.join(LINUX_DIR, 'apply_power_limits.py'), '--dry-run', file], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true });
    return out;
  };

  it('plans nvidia-smi -i <bus> -pl <W> only for valid entries', () => {
    const out = runDry({ limits: [
      { gpu: '00000000:01:00.0', watts: 450 },
      { gpu: '00000000:10:00.0; rm -rf /', watts: 300 },
      { gpu: '00000000:10:00.0', watts: 5000 },
      { gpu: '00000000:10:00.0', watts: true },
      { gpu: '00000000:10:00.0', watts: '300' },
    ] });
    expect(out).toContain('plan: -i 00000000:01:00.0 -pl 450');
    expect(out.match(/plan:/g)).toHaveLength(1);
    expect(out).toContain('skip: invalid gpu id');
    expect(out.match(/invalid watts/g)).toHaveLength(3);
  });

  it('does not echo the content of a non-JSON file (e.g. a symlink to a secret)', () => {
    const out = runDry('root:x:0:0:secret-line');
    expect(out).toContain('error: config is not valid JSON');
    expect(out).not.toContain('secret-line');
  });
});
