import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppState } from '../shared/types';

const api: Api = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    ipcRenderer.on('state', (_e, s: AppState) => cb(s));
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
};

contextBridge.exposeInMainWorld('crypthy', api);
