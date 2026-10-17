import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer/vendor', { recursive: true });
for (const f of ['index.html', 'style.css']) cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
cpSync('resources/icon.png', 'dist/icon.png');
cpSync('catalog/catalog.json', 'dist/catalog.json');
// TradingView Lightweight Charts (Apache-2.0): standalone 빌드 + LICENSE + NOTICE 를 함께 배포
const lwc = 'node_modules/lightweight-charts';
cpSync(`${lwc}/dist/lightweight-charts.standalone.production.js`, 'dist/renderer/vendor/lightweight-charts.standalone.production.js');
cpSync(`${lwc}/LICENSE`, 'dist/renderer/vendor/lightweight-charts-LICENSE.txt');
cpSync('resources/third-party/lightweight-charts-NOTICE.txt', 'dist/renderer/vendor/lightweight-charts-NOTICE.txt');
