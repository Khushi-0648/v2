const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: "windows",
  reportSecurityEvent: (eventData) => {
    ipcRenderer.send("security-event-report", eventData);
  },
  purgeClipboard: () => {
    ipcRenderer.send("purge-clipboard");
  },
  onOsScreenshotAttempt: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("os-screenshot-attempt", handler);
    return () => ipcRenderer.removeListener("os-screenshot-attempt", handler);
  },
  setMeetingState: (state) => {
    ipcRenderer.send("meeting-state-change", state);
  }
});
