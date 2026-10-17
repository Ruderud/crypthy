import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/renderer', { recursive: true });
for (const f of ['index.html', 'style.css']) cpSync(`src/renderer/${f}`, `dist/renderer/${f}`);
cpSync('resources/icon.png', 'dist/icon.png');
cpSync('catalog/catalog.json', 'dist/catalog.json');
