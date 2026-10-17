import { describe, expect, it } from 'vitest';
import { matchKnown, parseTasklist } from './miner';

const out = '"System Idle Process","0","Services","0","8 K"\r\n"SRBMiner-MULTI.exe","4321","Console","1","812,004 K"\r\n"srbminer-multi.exe","999","Console","1","10 K"\r\n"forge.exe","77","Console","1","1 K"\r\n';

describe('parseTasklist', () => {
  it('parses CSV rows', () => {
    expect(parseTasklist(out).slice(1, 3)).toEqual([{ name: 'SRBMiner-MULTI.exe', pid: 4321 }, { name: 'srbminer-multi.exe', pid: 999 }]);
  });
  it('returns [] for the "no tasks" message', () => {
    expect(parseTasklist('INFO: No tasks are running which match the specified criteria.\r\n')).toEqual([]);
  });
});

describe('matchKnown', () => {
  it('matches case-insensitively and reports each known miner once', () => {
    expect(matchKnown(parseTasklist(out), ['SRBMiner-MULTI.exe', 'peakminer.exe', 'forge.exe'])).toEqual(['SRBMiner-MULTI.exe', 'forge.exe']);
    expect(matchKnown([], ['forge.exe'])).toEqual([]);
  });
});
