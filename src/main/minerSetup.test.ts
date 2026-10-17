import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findExe, parseMd5File, parseRelease, verifyHashes } from './minerSetup';

const base = 'https://github.com/doktor83/SRBMiner-Multi/releases/download/3.7.6/';
const release = {
  tag_name: '3.7.6',
  assets: [
    { name: 'SRBMiner-Multi-3-7-6-Linux.tar.gz', size: 1, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: base + 'SRBMiner-Multi-3-7-6-Linux.tar.gz' },
    { name: 'SRBMiner-Multi-3-7-6-win64.md5', size: 66, digest: 'sha256:' + 'b'.repeat(64), browser_download_url: base + 'SRBMiner-Multi-3-7-6-win64.md5' },
    { name: 'SRBMiner-Multi-3-7-6-win64.zip', size: 29317276, digest: 'sha256:FB0ED55977AAD70B6EFB45E14C2C41263C557F1DF64FB02A1396C40C99EBAE3B', browser_download_url: base + 'SRBMiner-Multi-3-7-6-win64.zip' },
  ],
};

describe('parseRelease', () => {
  it('picks the win64 zip, its GitHub digest and the author .md5', () => {
    expect(parseRelease(release)).toEqual({
      tag: '3.7.6',
      name: 'SRBMiner-Multi-3-7-6-win64.zip',
      size: 29317276,
      sha256: 'fb0ed55977aad70b6efb45e14c2c41263c557f1df64fb02a1396c40c99ebae3b',
      url: base + 'SRBMiner-Multi-3-7-6-win64.zip',
      md5Url: base + 'SRBMiner-Multi-3-7-6-win64.md5',
    });
  });

  it('refuses foreign download hosts and missing digests', () => {
    const swap = (patch: object) => ({ ...release, assets: release.assets.map((a) => (a.name.endsWith('.zip') ? { ...a, ...patch } : a)) });
    expect(() => parseRelease(swap({ browser_download_url: 'https://evil.example/x-win64.zip' }))).toThrow(/다운로드 주소/);
    expect(() => parseRelease(swap({ digest: null }))).toThrow(/digest/);
    expect(() => parseRelease(swap({ size: 0 }))).toThrow(/크기/);
    expect(() => parseRelease({ assets: [] })).toThrow(/zip/);
  });
});

describe('hash verification', () => {
  const buf = Buffer.from('srbminer');
  const sha = createHash('sha256').update(buf).digest('hex');
  const md5 = createHash('md5').update(buf).digest('hex');

  it('parses md5 files', () => {
    expect(parseMd5File(`${md5.toUpperCase()}  SRBMiner-Multi-3-7-6-win64.zip\r\n`)).toBe(md5);
    expect(parseMd5File('nothing')).toBeNull();
  });

  it('accepts matching hashes and reports mismatches', () => {
    expect(verifyHashes(buf, sha, md5)).toBeNull();
    expect(verifyHashes(buf, sha, null)).toBeNull();
    expect(verifyHashes(buf, '0'.repeat(64), md5)).toMatch(/SHA-256/);
    expect(verifyHashes(buf, sha, '0'.repeat(32))).toMatch(/MD5/);
  });
});

describe('findExe', () => {
  it('finds the exe up to two levels deep, case-insensitively', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-'));
    const dir = path.join(root, 'SRBMiner-Multi-3-7-6');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'srbminer-multi.exe'), '');
    expect(findExe(root, 'SRBMiner-MULTI.exe')).toBe(dir);
    expect(findExe(root, 'other.exe')).toBeNull();
    expect(findExe(path.join(root, 'missing'), 'x.exe')).toBeNull();
    fs.rmSync(root, { recursive: true });
  });
});
