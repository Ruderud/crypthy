// CI 전용: 설치된 Crypthy 를 CDP 로 조작해 앱 안의 업데이트(받기 → 재시작해 설치)를 실제로 돌린다.
// usage: node scripts/smoke-ota.mjs <cdp-port>
const port = process.argv[2] ?? '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  throw new Error('no CDP page');
}

const ws = new WebSocket(await page());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  waiting.get(d.id)?.(d);
};
const evalJs = (expression) =>
  new Promise((r) => {
    const n = ++id;
    waiting.set(n, (d) => r(d.result?.result?.value));
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const status = () => evalJs('crypthy.getState().then(s => s.update)');

let u;
for (let i = 0; i < 120; i++) {
  u = await status();
  console.log('update', JSON.stringify({ status: u?.status, version: u?.version, error: u?.error }));
  if (u?.status === 'available') break;
  if (u?.status === 'idle' || u?.status === 'error') await evalJs('crypthy.checkUpdate()');
  await sleep(3000);
}
if (u?.status !== 'available') throw new Error('no update offered');
await evalJs('crypthy.downloadUpdate()');
for (let i = 0; i < 120; i++) {
  u = await status();
  if (u?.status === 'ready') break;
  await sleep(2000);
}
console.log('downloaded', JSON.stringify(u));
if (u?.status !== 'ready') throw new Error('download did not finish');
// 설치를 시작하면 앱이 바로 창을 닫으므로 응답을 기다리지 않는다 (이후 버전·실행 여부는 워크플로가 확인)
ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'crypthy.installUpdate()' } }));
console.log('install requested');
await sleep(2000);
ws.close();
process.exit(0);
