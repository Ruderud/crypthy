// README 3개 언어(영어 기본·한국어·중국어 간체)의 구조가 같은지 확인한다.
// 비교: 맨 위 언어 전환 줄, 제목 단계 순서, 표 행 수, 코드 블록(그대로 같아야 함), 링크·이미지 대상
import { readFileSync } from 'node:fs';

const FILES = {
  'README.md': '**English** | [한국어](README.ko.md) | [简体中文](README.zh-CN.md)',
  'README.ko.md': '[English](README.md) | **한국어** | [简体中文](README.zh-CN.md)',
  'README.zh-CN.md': '[English](README.md) | [한국어](README.ko.md) | **简体中文**',
};

function shape(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  const code = [];
  let tableRows = 0;
  let block = null;
  for (const line of lines) {
    const fence = /^\s*```/.test(line);
    if (block !== null) {
      if (fence) {
        code.push(block.join('\n'));
        block = null;
      } else block.push(line.trimStart());
      continue;
    }
    if (fence) {
      block = [];
      continue;
    }
    const h = /^(#{1,6})\s/.exec(line);
    if (h) headings.push(h[1].length);
    if (/^\|/.test(line)) tableRows++;
  }
  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => !/^README(\.[\w-]+)?\.md$/.test(u));
  return { first: lines[0], headings: headings.join(','), tableRows, code, links: [...new Set(links)].sort() };
}

const shapes = Object.fromEntries(Object.keys(FILES).map((f) => [f, shape(readFileSync(f, 'utf8'))]));
const errors = [];
const base = shapes['README.md'];
for (const [file, s] of Object.entries(shapes)) {
  if (s.first !== FILES[file]) errors.push(`${file}: first line must be the language switcher: ${FILES[file]}`);
  if (file === 'README.md') continue;
  if (s.headings !== base.headings) errors.push(`${file}: heading structure differs from README.md`);
  if (s.tableRows !== base.tableRows) errors.push(`${file}: table rows ${s.tableRows} != ${base.tableRows}`);
  if (s.code.length !== base.code.length) errors.push(`${file}: ${s.code.length} code blocks != ${base.code.length}`);
  else s.code.forEach((c, i) => c !== base.code[i] && errors.push(`${file}: code block #${i + 1} differs from README.md`));
  const missing = base.links.filter((l) => !s.links.includes(l));
  const extra = s.links.filter((l) => !base.links.includes(l));
  if (missing.length || extra.length) errors.push(`${file}: links differ (missing: ${missing.join(' ') || '-'}; extra: ${extra.join(' ') || '-'})`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`README structure in sync: ${Object.keys(FILES).join(', ')}`);
