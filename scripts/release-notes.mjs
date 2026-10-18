// CHANGELOG.md 에서 버전 섹션을 꺼내 릴리스 노트로 출력한다. 없으면 종료 코드 1.
// usage: node scripts/release-notes.mjs <version|vX.Y.Z>
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const text = readFileSync('CHANGELOG.md', 'utf8');
const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (!version || start < 0) {
  console.error(`CHANGELOG.md has no section for ${version || '(missing version)'}`);
  process.exit(1);
}
const rest = text.slice(start).split('\n').slice(1);
const end = rest.findIndex((l) => /^## \[/.test(l) || /^\[[^\]]+\]: /.test(l));
const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
console.log(`${body}\n\nFull changelog: [CHANGELOG.md](https://github.com/Ruderud/crypthy/blob/main/CHANGELOG.md). Verify downloads with SHA256SUMS.txt; builds are not code-signed.`);
