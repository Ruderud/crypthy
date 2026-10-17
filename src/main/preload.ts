import { contextBridge, ipcRenderer } from 'electron';
import type { Api, AppState } from '../shared/types';

const api: Api = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    ipcRenderer.on('state', (_e, s: AppState) => cb(s));
  },
  start: (selection) => ipcRenderer.invoke('miner:start', selection),
  stop: () => ipcRenderer.invoke('miner:stop'),
  clearExclusion: (id) => ipcRenderer.invoke('safety:clear', id),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  consent: () => ipcRenderer.invoke('setup:consent'),
  pickMinerDir: () => ipcRenderer.invoke('setup:pickMinerDir'),
  importBat: () => ipcRenderer.invoke('setup:importBat'),
  checkMinerRelease: () => ipcRenderer.invoke('miner:checkRelease'),
  downloadMiner: () => ipcRenderer.invoke('miner:download'),
  detectMapping: () => ipcRenderer.invoke('miner:detectMapping'),
  registerPowerTask: () => ipcRenderer.invoke('power:register'),
  applyPowerLimits: () => ipcRenderer.invoke('power:apply'),
};

contextBridge.exposeInMainWorld('crypthy', api);
