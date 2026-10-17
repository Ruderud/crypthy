// release/ 의 배포 산출물(.exe, .zip)에 대해 SHA256SUMS.txt 를 만든다 (코드 서명이 없으므로 무결성 확인용).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const files = readdirSync('release').filter((f) => /\.(exe|zip)$/i.test(f)).sort();
const lines = files.map((f) => `${createHash('sha256').update(readFileSync(`release/${f}`)).digest('hex')}  ${f}`);
writeFileSync('release/SHA256SUMS.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
