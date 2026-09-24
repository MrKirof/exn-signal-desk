const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exnDesktop", {
  getToken: () => ipcRenderer.invoke("desk-token"),
  resetToken: () => ipcRenderer.invoke("desk-reset"),
});
