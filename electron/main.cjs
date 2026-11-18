const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const PX_TO_MICRONS = 264.583; // 1 CSS px at 96 dpi

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#16241e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.on('closed', () => { mainWin = null; });
}

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('printers:list', async (event) => {
  try {
    const list = await event.sender.getPrintersAsync();
    return list.map((p) => ({ name: p.name, isDefault: !!p.isDefault }));
  } catch {
    return [];
  }
});

// Prints one receipt. The page is rendered in a hidden window, measured, then sent to the
// printer with no dialog. An empty printer name means the Windows default printer.
ipcMain.handle('print:html', (_event, html, opts) => {
  const printer = opts && typeof opts.printer === 'string' ? opts.printer : '';
  const widthMm = opts && opts.widthMm === 58 ? 58 : 80;
  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.once('did-fail-load', (_e, _code, desc) => finish({ ok: false, error: 'Could not prepare the receipt: ' + desc }));
    win.webContents.once('did-finish-load', async () => {
      try {
        const px = await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
        const height = Math.max(60000, Math.round((Number(px) + 24) * PX_TO_MICRONS));
        win.webContents.print(
          {
            silent: true,
            deviceName: printer,
            printBackground: false,
            margins: { marginType: 'none' },
            pageSize: { width: widthMm * 1000, height },
          },
          (ok, reason) => finish(ok ? { ok: true } : { ok: false, error: reason || 'The printer did not accept the job.' }),
        );
      } catch (err) {
        finish({ ok: false, error: String((err && err.message) || err) });
      }
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    setTimeout(() => finish({ ok: false, error: 'Printing timed out. Check that the printer is on and connected.' }), 30000);
  });
});
