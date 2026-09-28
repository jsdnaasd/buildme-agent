import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("personalAgent", {
  state: () => ipcRenderer.invoke("desktop:state"),
  catalog: () => ipcRenderer.invoke("desktop:catalog"),
  sessions: () => ipcRenderer.invoke("desktop:sessions"),
  messages: (sessionId) => ipcRenderer.invoke("desktop:messages", sessionId),
  send: (payload) => ipcRenderer.invoke("desktop:send", payload),
  abort: (sessionId) => ipcRenderer.invoke("desktop:abort", sessionId),
  saveKey: (key) => ipcRenderer.invoke("desktop:save-key", key),
  readClipboardText: () => ipcRenderer.invoke("desktop:read-clipboard-text"),
  openMarket: (market) => ipcRenderer.invoke("desktop:open-market", market),
  openFullEdition: () => ipcRenderer.invoke("desktop:open-full-edition"),
  setEdition: (edition) => ipcRenderer.invoke("desktop:set-edition", edition),
  saveConnection: (connection) => ipcRenderer.invoke("desktop:save-connection", connection),
  deleteConnection: (connectionId) => ipcRenderer.invoke("desktop:delete-connection", connectionId),
  selectConnection: (connectionId) => ipcRenderer.invoke("desktop:select-connection", connectionId),
  chooseWorkspace: () => ipcRenderer.invoke("desktop:choose-workspace"),
  setWorkspace: (path) => ipcRenderer.invoke("desktop:set-workspace", path),
  setPermissionMode: (mode) => ipcRenderer.invoke("desktop:set-permission-mode", mode),
  setTheme: (theme) => ipcRenderer.invoke("desktop:set-theme", theme),
  respondApproval: (requestId, allow) => ipcRenderer.invoke("desktop:approval-response", requestId, allow),
  onStream: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:stream", handler);
    return () => ipcRenderer.removeListener("desktop:stream", handler);
  },
  onApproval: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:approval", handler);
    return () => ipcRenderer.removeListener("desktop:approval", handler);
  },
});
