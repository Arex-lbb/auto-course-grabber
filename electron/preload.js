const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  auth: {
    save: (token) => ipcRenderer.invoke('auth:save', token),
    load: () => ipcRenderer.invoke('auth:load'),
    clear: () => ipcRenderer.invoke('auth:clear'),
    checkTokenStatus: () => ipcRenderer.invoke('auth:checkTokenStatus'),
    getCaptcha: () => ipcRenderer.invoke('auth:getCaptcha'),
    login: (params) => ipcRenderer.invoke('auth:login', params),
    loadCredentials: () => ipcRenderer.invoke('auth:loadCredentials'),
    clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials'),
    onTokenExpired: (callback) => {
      const listener = (_event, reason) => callback(reason);
      ipcRenderer.on('auth:tokenExpired', listener);
      return () => ipcRenderer.removeListener('auth:tokenExpired', listener);
    },
  },
  course: {
    resolveTerm: () => ipcRenderer.invoke('course:resolveTerm'),
    search: (params) => ipcRenderer.invoke('course:search', params),
    listPreferred: () => ipcRenderer.invoke('course:listPreferred'),
    apply: (params) => ipcRenderer.invoke('course:apply', params),
    select: (params) => ipcRenderer.invoke('course:select', params),
    checkChooseTime: (params) => ipcRenderer.invoke('course:checkChooseTime', params),
    listMySelections: (pageOpts) => ipcRenderer.invoke('course:listMySelections', pageOpts),
    listMyApplications: (pageOpts) => ipcRenderer.invoke('course:listMyApplications', pageOpts),
    cancelApplication: (applyId) => ipcRenderer.invoke('course:cancelApplication', applyId),
    getCapacity: (teachIds) => ipcRenderer.invoke('course:getCapacity', teachIds),
    updateChooseScore: (params) => ipcRenderer.invoke('course:updateChooseScore', params),
    syncServerTime: () => ipcRenderer.invoke('course:syncServerTime'),
  },
});
