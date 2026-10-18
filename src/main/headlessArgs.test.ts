import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHeadlessArgs } from './headlessArgs';

describe('headless arguments', () => {
  it('defaults to loopback, read-only, no consent', () => {
    const o = parseHeadlessArgs([], { CRYPTHY_DATA_DIR: '/var/lib/crypthy-headless' });
    expect(o).toMatchObject({ dataDir: '/var/lib/crypthy-headless', bind: '127.0.0.1', port: 47321, enableWrite: false, acceptRisk: false });
  });

  it('flags override the config file', () => {
    const o = parseHeadlessArgs(['--bind', '100.101.102.103', '--port', '48000', '--accept-risk'], {}, { bind: '127.0.0.1', port: 47000, enableWrite: true });
    expect(o).toMatchObject({ bind: '100.101.102.103', port: 48000, enableWrite: true, acceptRisk: true });
    expect(path.isAbsolute(o.dataDir)).toBe(true);
  });

  it('writes stay off unless explicitly enabled (flag or file true)', () => {
    expect(parseHeadlessArgs([], {}, { enableWrite: 'yes' }).enableWrite).toBe(false);
    expect(parseHeadlessArgs(['--enable-write'], {}).enableWrite).toBe(true);
  });

  it('rejects unknown flags, missing values and bad ports', () => {
    expect(() => parseHeadlessArgs(['--bind'], {})).toThrow();
    expect(() => parseHeadlessArgs(['--bind', '--enable-write'], {})).toThrow();
    expect(() => parseHeadlessArgs(['--expose-all'], {})).toThrow();
    expect(() => parseHeadlessArgs(['--port', '80'], {})).toThrow();
  });
});
