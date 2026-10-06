// Electron shell for Basera. Loads the built web app from ./app and keeps
// window.open (used for printing receipts) inside the app.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#F5F6F4',
    title: 'Basera',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Links to other sites open in the system browser; the app itself stays in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 640, height: 800, autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Smoke test hook used by CI: load the app, report, and quit.
  if (process.env.BASERA_SMOKE_TEST) {
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) console.error('[renderer]', message);
    });
    win.webContents.once('did-finish-load', async () => {
      const title = await win.webContents.executeJavaScript('document.title');
      const rendered = await win.webContents.executeJavaScript('document.querySelector("#root").children.length');
      console.log(`[smoke] loaded "${title}", root children: ${rendered}`);
      app.exit(rendered > 0 ? 0 : 1);
    });
  }

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
