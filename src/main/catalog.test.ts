import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedLinks, knownProcessNames, loadCatalog, parseCatalog, parseVendors, recommend, type Catalog } from './catalog';

const catalog = loadCatalog(path.join(__dirname, '../../catalog/catalog.json'));

describe('catalog file', () => {
  it('passes structural validation', () => {
    expect(catalog.coins.map((c) => c.id)).toEqual(['pearl', 'quantus']);
    expect(catalog.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('links only GitHub repositories, and never unverified tools', () => {
    for (const [id, t] of Object.entries(catalog.tools)) {
      if (t.repoKind === 'unverified') expect(t.repo, id).toBeNull();
      else expect(t.repo, id).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('every verified dev fee has a source', () => {
    for (const c of catalog.coins) for (const t of c.tools) if (t.devFee.status === 'verified') expect(t.devFee.source, `${c.id}/${t.tool}`).toBeTruthy();
  });
});

describe('parseCatalog', () => {
  const base: Catalog = { version: 1, checkedAt: '2026-10-17', tools: { a: { name: 'A', repo: 'https://github.com/x/a', repoKind: 'developer', processNames: ['a.exe'], statsApi: null, apiNote: '', sources: [] } }, coins: [] };
  it('rejects unknown tool references, non-GitHub repos and sourceless verified fees', () => {
    const coin = (devFee: object, tool = 'a') => ({ id: 'c', name: 'C', symbol: 'C', algorithm: 'x', coingeckoId: 'c', pools: [], tools: [{ tool, vendors: [], devFee, note: '' }] });
    expect(() => parseCatalog({ ...base, coins: [coin({ pct: 1, status: 'verified', source: 'u' }, 'zzz')] })).toThrow(/unknown tool/);
    expect(() => parseCatalog({ ...base, coins: [coin({ pct: 1, status: 'verified', source: null })] })).toThrow(/needs pct and source/);
    expect(() => parseCatalog({ ...base, tools: { a: { ...base.tools.a, repo: 'https://evil.example/a' } } })).toThrow(/GitHub/);
    expect(() => parseCatalog({ ...base, tools: { a: { ...base.tools.a, repo: null } } })).toThrow(/unverified/);
  });
});

describe('recommend', () => {
  it('Pearl on NVIDIA: verified lowest fee first, Intel-only tool last as incompatible', () => {
    const r = recommend(catalog, 'pearl', ['nvidia']);
    expect(r.map((x) => [x.rank, x.tool, x.compatible])).toEqual([
      [1, 'srbminer', true],
      [2, 'forgeminer', true],
      [3, 'peakminer', true],
      [4, 'arcminer', false],
    ]);
    expect(r[3].repo).toBeNull();
  });

  it('Pearl on Intel only: ARCMiner is the only compatible tool', () => {
    expect(recommend(catalog, 'pearl', ['intel']).filter((x) => x.compatible).map((x) => x.tool)).toEqual(['arcminer']);
  });

  it('Quantus: fee conflicts and unverified fees rank after verified ones', () => {
    expect(recommend(catalog, 'quantus', ['nvidia']).map((x) => [x.tool, x.devFee.status])).toEqual([
      ['forgeminer', 'verified'],
      ['peakminer', 'verified'],
      ['srbminer', 'conflict'],
      ['quantus-miner', 'unverified'],
    ]);
  });

  it('treats every tool as compatible when no vendor was detected; unknown coin → []', () => {
    expect(recommend(catalog, 'pearl', []).every((x) => x.compatible)).toBe(true);
    expect(recommend(catalog, 'nope', ['nvidia'])).toEqual([]);
  });
});

describe('helpers', () => {
  it('collects known miner process names', () => {
    expect(knownProcessNames(catalog)).toEqual(['SRBMiner-MULTI.exe', 'peakminer.exe', 'forge.exe', 'arc-miner.exe']);
  });

  it('allows only catalog links', () => {
    const links = allowedLinks(catalog);
    expect(links.has('https://github.com/doktor83/SRBMiner-Multi')).toBe(true);
    expect(links.has('https://example.com')).toBe(false);
  });

  it('parses GPU vendors from Win32_VideoController names', () => {
    expect(parseVendors('NVIDIA GeForce RTX 5090\r\nAMD Radeon(TM) Graphics\r\nIntel(R) Arc(TM) A770\r\n')).toEqual(['nvidia', 'amd', 'intel']);
    expect(parseVendors('Microsoft Basic Display Adapter\r\n')).toEqual([]);
  });
});
