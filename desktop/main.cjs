const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("node:url");

const port = 8090;

function dataDir() {
  return path.join(app.getPath("userData"), "desk-data");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    delete process.env.DATABASE_URL;
    const receiverUrl = pathToFileURL(path.join(__dirname, "receiver.mjs")).href;
    const { startReceiver } = await import(receiverUrl);
    const uiDir = path.join(__dirname, "dist-ui");
    const zipPath = path.join(__dirname, "..", "public", "exn-collector.zip");
    const started = await startReceiver({ port, dataDir: dataDir(), uiDir, zipPath, host: "127.0.0.1" });
    ipcMain.handle("desk-token", () => started.token);
    ipcMain.handle("desk-reset", async () => {
      const { resetToken } = await import(pathToFileURL(path.join(__dirname, "pair.mjs")).href);
      started.token = resetToken(dataDir());
      return started.token;
    });
    const win = new BrowserWindow({
      width: 1360,
      height: 860,
      autoHideMenuBar: true,
      backgroundColor: "#03030a",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await win.loadURL(`http://127.0.0.1:${started.port}/`);
  });
}
