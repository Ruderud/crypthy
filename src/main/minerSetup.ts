// SRBMiner-MULTI 는 재배포하지 않는다. 사용자가 동의하면 공식 GitHub 릴리스에서 내려받고
// (1) GitHub 가 제공하는 asset SHA-256 digest, (2) 작성자가 같은 릴리스에 올린 .md5 파일 두 가지로 검증한다.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MinerRelease } from '../shared/types';

export const RELEASE_API = 'https://api.github.com/repos/doktor83/SRBMiner-Multi/releases/latest';
const DOWNLOAD_PREFIX = 'https://github.com/doktor83/SRBMiner-Multi/releases/download/';
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

export interface ReleaseInfo extends MinerRelease {
  md5Url: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** releases/latest 응답에서 Windows x64 zip 과 .md5 를 고른다 */
export function parseRelease(json: unknown): ReleaseInfo {
  if (!isObj(json) || !Array.isArray(json.assets)) throw new Error('릴리스 응답 형식이 올바르지 않습니다');
  const assets = json.assets.filter(isObj);
  const zip = assets.find((a) => typeof a.name === 'string' && /-win64\.zip$/i.test(a.name));
  if (!zip) throw new Error('Windows x64 zip 을 찾지 못했습니다');
  const url = String(zip.browser_download_url ?? '');
  if (!url.startsWith(DOWNLOAD_PREFIX)) throw new Error(`예상하지 못한 다운로드 주소: ${url}`);
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(zip.digest ?? ''));
  if (!digest) throw new Error('GitHub SHA-256 digest 가 없어 검증할 수 없습니다. 수동 설치 후 폴더를 지정해 주세요');
  const md5 = assets.find((a) => a.name === String(zip.name).replace(/\.zip$/i, '.md5'));
  const md5Url = md5 && String(md5.browser_download_url ?? '').startsWith(DOWNLOAD_PREFIX) ? String(md5.browser_download_url) : null;
  const size = Number(zip.size);
  if (!(size > 0 && size < MAX_ZIP_BYTES)) throw new Error('zip 크기가 비정상입니다');
  return { tag: String(json.tag_name ?? ''), name: String(zip.name), size, sha256: digest[1].toLowerCase(), url, md5Url };
}

/** .md5 파일 내용에서 32자리 해시 추출 */
export function parseMd5File(text: string): string | null {
  return /\b([0-9a-f]{32})\b/i.exec(text)?.[1].toLowerCase() ?? null;
}

export function verifyHashes(buf: Buffer, sha256: string, md5: string | null): string | null {
  const gotSha = createHash('sha256').update(buf).digest('hex');
  if (gotSha !== sha256) return `SHA-256 불일치 (기대 ${sha256}, 실제 ${gotSha})`;
  if (md5 !== null) {
    const gotMd5 = createHash('md5').update(buf).digest('hex');
    if (gotMd5 !== md5) return `MD5 불일치 (기대 ${md5}, 실제 ${gotMd5})`;
  }
  return null;
}

/** 압축 해제 폴더에서 실행 파일을 찾는다 (최대 2단계) */
export function findExe(root: string, exe: string): string | null {
  const walk = (dir: string, depth: number): string | null => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.toLowerCase() === exe.toLowerCase()) return dir;
    }
    if (depth === 0) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const hit = walk(path.join(dir, e.name), depth - 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return fs.existsSync(root) ? walk(root, 2) : null;
}

async function get(url: string, timeoutMs: number): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'crypthy' } });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res;
}

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  return parseRelease(await (await get(RELEASE_API, 15_000)).json());
}

/** 내려받기 → 해시 검증 → Windows 내장 tar.exe 로 압축 해제 → 실행 파일이 있는 폴더 반환 */
export async function installRelease(rel: ReleaseInfo, destRoot: string, exe: string): Promise<string> {
  const md5 = rel.md5Url ? parseMd5File(await (await get(rel.md5Url, 15_000)).text()) : null;
  const buf = Buffer.from(await (await get(rel.url, 10 * 60_000)).arrayBuffer());
  if (buf.length !== rel.size) throw new Error(`크기 불일치 (기대 ${rel.size}, 실제 ${buf.length})`);
  const bad = verifyHashes(buf, rel.sha256, md5);
  if (bad) throw new Error(bad);

  const dest = path.join(destRoot, rel.tag.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(dest, { recursive: true });
  const zipPath = path.join(destRoot, rel.name);
  fs.writeFileSync(zipPath, buf);
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  await new Promise<void>((resolve, reject) =>
    execFile(tar, ['-xf', zipPath, '-C', dest], { timeout: 120_000, windowsHide: true }, (err) => (err ? reject(err) : resolve())),
  );
  fs.rmSync(zipPath, { force: true });
  const dir = findExe(dest, exe);
  if (!dir) throw new Error(`${exe} 를 찾지 못했습니다. Windows 보안(Defender)이 격리했는지 확인해 주세요`);
  return dir;
}
