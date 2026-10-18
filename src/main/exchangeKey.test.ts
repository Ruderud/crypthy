import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadKeyFile, parseKeyInput } from './exchangeKey';

const KEY = 'a1b2c3d4e5f6a7b8';
const SECRET = 'S3cr3tS3cr3tS3cr3tS3cr3tS3cr3t00';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-key-'));
const write = (dir: string, body: string, mode = 0o600) => {
  const f = path.join(dir, 'safetrade-key.json');
  fs.writeFileSync(f, body);
  fs.chmodSync(f, mode);
  return f;
};

describe('SafeTrade key input and files', () => {
  it('accepts a plain key and secret, rejects anything else without echoing the value', () => {
    expect(parseKeyInput(` ${KEY} `, SECRET)).toEqual({ key: KEY, secret: SECRET });
    for (const [k, s] of [['', SECRET], [KEY, 'short'], [`${KEY}\n`, `x${SECRET}"`], [KEY, KEY], [1, null]] as const) {
      const r = parseKeyInput(k, s);
      expect(typeof r).toBe('string');
      expect(r as string).not.toContain(KEY);
      expect(r as string).not.toContain(SECRET);
    }
  });

  it('prefers the systemd credential, then the data folder file', () => {
    const data = tmp();
    const cred = tmp();
    write(data, JSON.stringify({ key: 'datafolderkey000', secret: SECRET }));
    write(cred, JSON.stringify({ key: KEY, secret: SECRET }), 0o400);
    expect(loadKeyFile(data, { CREDENTIALS_DIRECTORY: cred })).toEqual({ key: { key: KEY, secret: SECRET }, store: 'systemd credential', error: null });
    expect(loadKeyFile(data, {}).key?.key).toBe('datafolderkey000');
    expect(loadKeyFile(tmp(), {})).toEqual({ key: null, store: null, error: null });
  });

  it.skipIf(process.platform === 'win32')('refuses a key file other users can read', () => {
    const data = tmp();
    write(data, JSON.stringify({ key: KEY, secret: SECRET }), 0o644);
    const r = loadKeyFile(data, {});
    expect(r.key).toBeNull();
    expect(r.error).toMatch(/chmod 600/);
  });

  it('a broken or invalid file gives an error without the key', () => {
    const data = tmp();
    write(data, `{"key": "${KEY}", "secret": `);
    const broken = loadKeyFile(data, {});
    expect(broken.key).toBeNull();
    expect(broken.error).not.toContain(KEY);
    write(data, JSON.stringify({ key: KEY, secret: 'x' }));
    const bad = loadKeyFile(data, {});
    expect(bad.error).toMatch(/시크릿/);
    expect(bad.error).not.toContain(KEY);
  });
});
