import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  auth: {
    save: (token: string) => ipcRenderer.invoke('auth:save', token),
    load: () => ipcRenderer.invoke('auth:load'),
    clear: () => ipcRenderer.invoke('auth:clear'),
    checkTokenStatus: () => ipcRenderer.invoke('auth:checkTokenStatus'),
    getCaptcha: () => ipcRenderer.invoke('auth:getCaptcha'),
    login: (params: unknown) => ipcRenderer.invoke('auth:login', params),
    loadCredentials: () => ipcRenderer.invoke('auth:loadCredentials'),
    clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials'),
    onTokenExpired: (callback: (reason: string) => void) => {
      const listener = (_event: unknown, reason: string) => callback(reason);
      ipcRenderer.on('auth:tokenExpired', listener);
      return () => { ipcRenderer.removeListener('auth:tokenExpired', listener); };
    },
  },
  course: {
    resolveTerm: () => ipcRenderer.invoke('course:resolveTerm'),
    search: (params: unknown) => ipcRenderer.invoke('course:search', params),
    listPreferred: () => ipcRenderer.invoke('course:listPreferred'),
    apply: (params: unknown) => ipcRenderer.invoke('course:apply', params),
    listMyApplications: (pageOpts?: unknown) => ipcRenderer.invoke('course:listMyApplications', pageOpts),
    cancelApplication: (applyId: string) => ipcRenderer.invoke('course:cancelApplication', applyId),
    getCapacity: (teachIds: string[]) => ipcRenderer.invoke('course:getCapacity', teachIds),
    updateChooseScore: (params: unknown) => ipcRenderer.invoke('course:updateChooseScore', params),
    syncServerTime: () => ipcRenderer.invoke('course:syncServerTime'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
