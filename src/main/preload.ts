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
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openLink: (url) => ipcRenderer.invoke('hub:openLink', url),
  getCharts: () => ipcRenderer.invoke('charts:get'),
};

contextBridge.exposeInMainWorld('crypthy', api);
