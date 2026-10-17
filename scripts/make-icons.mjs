// 의존성 없이 256×256 PNG 아이콘 생성 (어두운 원 + 녹색 번개 모양 막대). electron-builder가 .ico로 변환한다.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 256;
const px = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const dx = x - S / 2 + 0.5;
    const dy = y - S / 2 + 0.5;
    const r = Math.hypot(dx, dy);
    if (r > 120) continue; // 투명
    let c = [24, 29, 35];
    if (r > 110) c = [63, 185, 122];
    // 막대 3개 (해시레이트 그래프 느낌)
    const bars = [[72, 104, 150], [114, 146, 110], [156, 188, 70]];
    for (const [x0, x1, top] of bars) if (x >= x0 && x < x1 && y >= top && y < 190) c = [63, 185, 122];
    px.set([...c, 255], i);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('resources/icon.png', png);
console.log('resources/icon.png', png.length, 'bytes');
