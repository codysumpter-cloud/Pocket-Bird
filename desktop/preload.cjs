const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PocketBuddyDesktop", {
  setInteractive(interactive) {
    ipcRenderer.send("pocket-buddy:set-interactive", Boolean(interactive));
  },
  quit() {
    ipcRenderer.send("pocket-buddy:quit");
  },
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("pocket-buddy:command", handler);
    return () => ipcRenderer.removeListener("pocket-buddy:command", handler);
  },
});
