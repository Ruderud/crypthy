import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppState } from '../shared/types';

const api: Api = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    ipcRenderer.on('state', (_e, s: AppState) => cb(s));
  },
  onFocusUpdate: (cb) => {
    ipcRenderer.on('update:focus', () => cb());
  },
  clearHold: (id) => ipcRenderer.invoke('safety:clearHold', id),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  importBat: () => ipcRenderer.invoke('setup:importBat'),
  registerPowerTask: () => ipcRenderer.invoke('power:register'),
  applyPowerLimits: () => ipcRenderer.invoke('power:apply'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  dismissUpdate: () => ipcRenderer.invoke('update:dismiss'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openLink: (url) => ipcRenderer.invoke('hub:openLink', url),
  getCharts: () => ipcRenderer.invoke('charts:get'),
  addSale: (sale) => ipcRenderer.invoke('pnl:sale', sale),
  bootstrapPnl: (fromMs, watts) => ipcRenderer.invoke('pnl:bootstrap', fromMs, watts),
  exportPnl: () => ipcRenderer.invoke('pnl:export'),
  openPnlFolder: () => ipcRenderer.invoke('pnl:openFolder'),
  getRemote: () => ipcRenderer.invoke('remote:get'),
  connectRemote: (url, readToken, writeToken) => ipcRenderer.invoke('remote:connect', url, readToken, writeToken),
  disconnectRemote: () => ipcRenderer.invoke('remote:disconnect'),
  startMining: () => ipcRenderer.invoke('miner:start'),
  stopMining: () => ipcRenderer.invoke('miner:stop'),
  importMinerTask: () => ipcRenderer.invoke('miner:importTask'),
  disableMinerTask: () => ipcRenderer.invoke('miner:disableTask'),
  setGpuMining: (id, mine) => ipcRenderer.invoke('miner:gpu', id, mine),
  minerLog: () => ipcRenderer.invoke('miner:log'),
  pickPath: (kind, current) => ipcRenderer.invoke('dialog:pickPath', kind, current),
  setExchangeKey: (key, secret) => ipcRenderer.invoke('autosell:setKey', key, secret),
  runAutoSell: (dryRun) => ipcRenderer.invoke('autosell:run', dryRun),
  openCharts: (tab) => ipcRenderer.invoke('charts:open', tab),
  onChartsTab: (cb) => {
    ipcRenderer.on('charts:tab', (_e, tab: string) => cb(tab));
  },
};

contextBridge.exposeInMainWorld('crypthy', api);
