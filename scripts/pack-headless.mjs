// 헤드리스 배포 묶음: release/crypthy-headless-<version>.tar.gz
// Electron 없이 Node(18+)로 도는 코어·원격 API 와 Linux 설치 스크립트만 담는다 (화면·업데이터 없음, 외부 의존성 없음).
// 먼저 `npm run build` 로 dist/ 를 만든 뒤 실행한다.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `crypthy-headless-${pkg.version}`;
const stage = path.join('release', 'headless-stage');
const root = path.join(stage, name);
if (!existsSync('dist/main/headless.js')) throw new Error('run `npm run build` first');

rmSync(stage, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
for (const d of ['dist/main', 'dist/shared']) cpSync(d, path.join(root, d), { recursive: true });
cpSync('dist/catalog.json', path.join(root, 'dist/catalog.json'));
// 숨김 파일(로컬 도구 상태 등)은 넣지 않는다
cpSync('resources/linux', path.join(root, 'resources/linux'), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
cpSync('LICENSE', path.join(root, 'LICENSE'));
cpSync('resources/linux/headless/README.md', path.join(root, 'README-headless.md'));
// 실행에 필요한 것만 남긴 package.json (버전 표시용)
writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'crypthy-headless', version: pkg.version, private: true, license: pkg.license, main: 'dist/main/headless.js' }, null, 2)}\n`);
writeFileSync(path.join(root, 'install.sh'), '#!/bin/sh\n# sudo ./install.sh --user <name> [--bind <Tailscale IP>] [--enable-write] [--accept-risk] [--power-limits]\nexec sh "$(dirname -- "$0")/resources/linux/headless/install.sh" "$@"\n', { mode: 0o755 });

const out = path.join('release', `${name}.tar.gz`);
execFileSync('tar', ['-czf', out, '-C', stage, name], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
rmSync(stage, { recursive: true, force: true });
console.log(out);
