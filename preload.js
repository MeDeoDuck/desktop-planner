// preload.js — contextBridge로 안전하게 IPC API 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('planner', {
  // 데이터
  get: (dateKey) => ipcRenderer.invoke('planner:get', dateKey),
  set: (dateKey, content) => ipcRenderer.invoke('planner:set', dateKey, content),
  markedDates: () => ipcRenderer.invoke('planner:markedDates'),

  // 전역 메모 (날짜 무관)
  getMemo: () => ipcRenderer.invoke('memo:get'),
  setMemo: (text) => ipcRenderer.invoke('memo:set', text),

  // 설정/창
  getSettings: () => ipcRenderer.invoke('settings:get'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),

  // 외부 브라우저로 링크 열기 (작업 A)
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
