const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("marklendAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_event, data) => callback(data)),
  exportPDF: (opts) => ipcRenderer.invoke("export-pdf", opts),
  getLogo: () => ipcRenderer.invoke("get-logo"),
  composeEmail: (opts) => ipcRenderer.invoke("compose-email", opts),
  getVersion: () => ipcRenderer.invoke("get-version"),
  getUpdateState: () => ipcRenderer.invoke("get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  restartAndInstall: () => ipcRenderer.invoke("restart-and-install"),
});
