const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("personalAgent", {
  state: () => ipcRenderer.invoke("desktop:state"),
  setCapability: (id, enabled) => ipcRenderer.invoke("desktop:set-capability", id, enabled),
  chooseCapabilities: (choice) => ipcRenderer.invoke("desktop:choose-capabilities", choice),
  onCapabilityUsage: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:capability-usage", handler);
    return () => ipcRenderer.removeListener("desktop:capability-usage", handler);
  },
  achievements: () => ipcRenderer.invoke("desktop:achievements"),
  learningEvent: (event) => ipcRenderer.invoke("desktop:learning-event", event),
  exportLearning: () => ipcRenderer.invoke("desktop:export-learning"),
  onAchievements: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:achievements", handler);
    return () => ipcRenderer.removeListener("desktop:achievements", handler);
  },
  catalog: () => ipcRenderer.invoke("desktop:catalog"),
  sessions: () => ipcRenderer.invoke("desktop:sessions"),
  messages: (sessionId) => ipcRenderer.invoke("desktop:messages", sessionId),
  xrayTurns: (sessionId) => ipcRenderer.invoke("desktop:xray-turns", sessionId),
  xrayTurn: (turnId) => ipcRenderer.invoke("desktop:xray-turn", turnId),
  xrayPromptSource: (turnId, segmentIndex, open) => ipcRenderer.invoke("desktop:xray-prompt-source", turnId, segmentIndex, open),
  setRecordRawRequests: (enabled) => ipcRenderer.invoke("desktop:set-record-raw-requests", enabled),
  onXray: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:xray", handler);
    return () => ipcRenderer.removeListener("desktop:xray", handler);
  },
  send: (payload) => ipcRenderer.invoke("desktop:send", payload),
  abort: (sessionId) => ipcRenderer.invoke("desktop:abort", sessionId),
  saveKey: (key) => ipcRenderer.invoke("desktop:save-key", key),
  readClipboardText: () => ipcRenderer.invoke("desktop:read-clipboard-text"),
  writeClipboardText: (text) => ipcRenderer.invoke("desktop:write-clipboard-text", text),
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
  onApprovalClosed: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:approval-closed", handler);
    return () => ipcRenderer.removeListener("desktop:approval-closed", handler);
  },
  onApproval: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("desktop:approval", handler);
    return () => ipcRenderer.removeListener("desktop:approval", handler);
  },
});
