const { contextBridge, ipcRenderer } = require('electron');

// The only thing the web page can do on the computer: list printers and print a receipt.
contextBridge.exposeInMainWorld('posPrint', {
  isDesktop: true,
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  printHtml: (html, opts) => ipcRenderer.invoke('print:html', html, opts),
});
