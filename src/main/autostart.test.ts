import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { autostartFile, buildDesktopEntry, quoteExec, setLinuxAutostart } from './autostart';

describe('desktop entry', () => {
  it('can start with the window shown (no --hidden)', () => {
    const e = buildDesktopEntry('/opt/crypthy/crypthy', false);
    expect(e).toContain('Exec="/opt/crypthy/crypthy"\n');
    expect(e).not.toContain('--hidden');
  });

  it('quotes the executable and passes --hidden', () => {
    expect(buildDesktopEntry('/home/u/Apps/Crypthy-0.3.0-linux-x86_64.AppImage')).toContain('Exec="/home/u/Apps/Crypthy-0.3.0-linux-x86_64.AppImage" --hidden');
  });
  it('escapes reserved characters and rejects newlines', () => {
    expect(quoteExec('/a b/$x"y`z\\w')).toBe('"/a b/\\$x\\"y\\`z\\\\w"');
    expect(() => quoteExec('/a\nb')).toThrow();
  });
  it('honors XDG_CONFIG_HOME', () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/tmp/xdg';
    expect(autostartFile('/home/u')).toBe('/tmp/xdg/autostart/crypthy.desktop');
    delete process.env.XDG_CONFIG_HOME;
    expect(autostartFile('/home/u')).toBe('/home/u/.config/autostart/crypthy.desktop');
    if (prev !== undefined) process.env.XDG_CONFIG_HOME = prev;
  });
  it('writes and removes the autostart file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-as-'));
    const f = path.join(dir, 'autostart', 'crypthy.desktop');
    setLinuxAutostart(true, true, '/opt/crypthy/crypthy', f);
    expect(fs.readFileSync(f, 'utf8')).toContain('Exec="/opt/crypthy/crypthy" --hidden');
    setLinuxAutostart(false, true, '/opt/crypthy/crypthy', f);
    expect(fs.existsSync(f)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});
