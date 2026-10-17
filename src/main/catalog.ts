// 큐레이션 카탈로그(catalog/catalog.json): 코인 → 알고리즘 → 호환 채굴 툴 추천과 공식 저장소 링크.
// Crypthy 는 채굴기를 내려받거나 실행하지 않는다.
import fs from 'node:fs';
import type { FeeStatus, RecommendationView, Vendor } from '../shared/types';

export type { FeeStatus, Vendor };

export type Platform = 'windows' | 'linux';

export interface CatalogTool {
  name: string;
  repo: string | null;
  repoKind: 'developer' | 'distribution' | 'unverified';
  repoNote?: string;
  /** 플랫폼별 실행 파일 이름 (릴리스 아카이브에서 확인한 것만) */
  processNames: Record<Platform, string[]>;
  statsApi: string | null;
  apiNote: string;
  sources: string[];
}

export interface CoinTool {
  tool: string;
  vendors: Vendor[];
  devFee: { pct: number | null; status: FeeStatus; source: string | null; note?: string };
  note: string;
}

export interface CatalogCoin {
  id: string;
  name: string;
  symbol: string;
  algorithm: string;
  coingeckoId: string;
  pools: { name: string; stats: string; ticker: string; examples: string[]; source: string }[];
  tools: CoinTool[];
}

export interface Catalog {
  version: number;
  checkedAt: string;
  tools: Record<string, CatalogTool>;
  coins: CatalogCoin[];
}

export type Recommendation = RecommendationView;

/** 최소 구조 검증 (카탈로그는 저장소 안의 파일이라 형식 오류는 빌드·테스트에서 잡는다) */
export function parseCatalog(json: unknown): Catalog {
  const c = json as Catalog;
  if (!c || !Array.isArray(c.coins) || typeof c.tools !== 'object') throw new Error('catalog: invalid structure');
  for (const coin of c.coins) {
    for (const t of coin.tools) {
      if (!c.tools[t.tool]) throw new Error(`catalog: ${coin.id} references unknown tool ${t.tool}`);
      if (t.devFee.status === 'verified' && (t.devFee.pct === null || !t.devFee.source)) throw new Error(`catalog: ${coin.id}/${t.tool} verified fee needs pct and source`);
    }
  }
  if (c.coins.length === 0) throw new Error('catalog: no coins');
  const https = (u: string | null) => u === null || /^https:\/\/[^\s"'<>]+$/.test(u);
  for (const coin of c.coins) {
    if (!coin.pools.every((p) => https(p.source)) || !coin.tools.every((t) => https(t.devFee.source))) throw new Error(`catalog: ${coin.id} has a non-https source`);
  }
  for (const [id, t] of Object.entries(c.tools)) {
    if (!t.sources.every(https)) throw new Error(`catalog: ${id} has a non-https source`);
    // taskkill /im 에 넘기는 값이라 단순 실행 파일 이름만 허용
    const names = t.processNames ?? ({} as CatalogTool['processNames']);
    if (!Array.isArray(names.windows) || !names.windows.every((n) => /^[\w.-]+\.exe$/i.test(n))) throw new Error(`catalog: ${id} has an invalid windows process name`);
    if (!Array.isArray(names.linux) || !names.linux.every((n) => /^[\w.-]{1,64}$/.test(n) && !n.endsWith('.exe'))) throw new Error(`catalog: ${id} has an invalid linux process name`);
    if (t.repo !== null && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(t.repo)) throw new Error(`catalog: ${id} repo must be a GitHub repository URL`);
    if (t.repo === null && t.repoKind !== 'unverified') throw new Error(`catalog: ${id} without repo must be unverified`);
  }
  return c;
}

export function loadCatalog(file: string): Catalog {
  return parseCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const FEE_ORDER: Record<FeeStatus, number> = { verified: 0, conflict: 1, unverified: 2 };

/**
 * 추천 순위: (1) 감지된 GPU 벤더와 호환 (2) dev fee 확인됨 → 출처 불일치 → 미확인
 * (3) 확인된 fee 가 낮은 순 (4) 카탈로그 순서. 벤더를 하나도 감지하지 못하면 호환 여부는 따지지 않는다.
 */
export function recommend(catalog: Catalog, coinId: string, vendors: Vendor[]): Recommendation[] {
  const coin = catalog.coins.find((c) => c.id === coinId);
  if (!coin) return [];
  return coin.tools
    .map((t, i) => {
      const tool = catalog.tools[t.tool];
      const compatible = vendors.length === 0 || t.vendors.some((v) => vendors.includes(v));
      return { t, i, tool, compatible };
    })
    .sort(
      (a, b) =>
        Number(b.compatible) - Number(a.compatible) ||
        FEE_ORDER[a.t.devFee.status] - FEE_ORDER[b.t.devFee.status] ||
        (a.t.devFee.pct ?? 99) - (b.t.devFee.pct ?? 99) ||
        a.i - b.i,
    )
    .map(({ t, tool, compatible }, rank) => ({
      ...t,
      rank: rank + 1,
      name: tool.name,
      repo: tool.repo,
      repoKind: tool.repoKind,
      repoNote: tool.repoNote ?? null,
      apiNote: tool.apiNote,
      compatible,
    }));
}

/** 안전 감시가 정지할 수 있는 알려진 채굴기 실행 파일 (플랫폼별) */
export function knownProcessNames(catalog: Catalog, platform: Platform): string[] {
  return [...new Set(Object.values(catalog.tools).flatMap((t) => t.processNames[platform]))];
}

/** 외부로 열 수 있는 링크는 카탈로그에 있는 저장소·출처뿐 */
export function allowedLinks(catalog: Catalog): Set<string> {
  const urls = new Set<string>();
  for (const t of Object.values(catalog.tools)) {
    if (t.repo) urls.add(t.repo);
    t.sources.forEach((s) => urls.add(s));
  }
  for (const c of catalog.coins) {
    c.pools.forEach((p) => urls.add(p.source));
    c.tools.forEach((t) => t.devFee.source && urls.add(t.devFee.source));
  }
  return urls;
}

/** Win32_VideoController 이름 목록 → GPU 벤더 */
export function parseVendors(out: string): Vendor[] {
  const vendors = new Set<Vendor>();
  for (const line of out.split(/\r?\n/)) {
    if (/nvidia|geforce|quadro|tesla/i.test(line)) vendors.add('nvidia');
    else if (/\bamd\b|radeon|\bati\b/i.test(line)) vendors.add('amd');
    else if (/intel/i.test(line)) vendors.add('intel');
  }
  return (['nvidia', 'amd', 'intel'] as const).filter((v) => vendors.has(v));
}
