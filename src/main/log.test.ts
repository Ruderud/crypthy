import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileLogger } from './log';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-log-'));

describe('file logger', () => {
  it('appends timestamped lines with level, including error stacks', () => {
    const dir = tmp();
    const f = path.join(dir, 'logs', 'main.log');
    const log = createFileLogger(f, 1024 * 1024, () => new Date('2026-10-18T02:37:53Z'));
    log.info('update', { status: 'ready', version: '0.3.9' });
    log.error(new Error('installer failed'));
    log.debug('noise');
    const text = fs.readFileSync(f, 'utf8');
    expect(text.split('\n')[0]).toBe('2026-10-18T02:37:53.000Z [info] update {"status":"ready","version":"0.3.9"}');
    expect(text).toContain('[error] installer failed');
    expect(text).not.toContain('noise');
    fs.rmSync(dir, { recursive: true });
  });

  it('rotates once to main.old.log at the size cap', () => {
    const dir = tmp();
    const f = path.join(dir, 'main.log');
    const log = createFileLogger(f, 300);
    for (let i = 0; i < 20; i++) log.info(`line ${i}`);
    expect(fs.existsSync(path.join(dir, 'main.old.log'))).toBe(true);
    expect(fs.statSync(f).size).toBeLessThanOrEqual(300);
    expect(fs.readFileSync(f, 'utf8')).toContain('line 19');
    fs.rmSync(dir, { recursive: true });
  });

  it('never throws when the log cannot be written', () => {
    const dir = tmp();
    const notADir = path.join(dir, 'file');
    fs.writeFileSync(notADir, 'x');
    expect(() => createFileLogger(path.join(notADir, 'logs', 'main.log')).info('x')).not.toThrow();
    fs.rmSync(dir, { recursive: true });
  });
});
