const { app, BrowserWindow, shell } = require('electron');

const APP_URL = process.env.AETHERIS_DESKTOP_URL || 'https://www.aetherisai.me';
const APP_HOST = new URL(APP_URL).hostname;

function isTrustedNavigation(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return false;
  const host = url.hostname.toLowerCase();
  return (
    host === APP_HOST ||
    host.endsWith('.google.com') ||
    host.endsWith('.googleapis.com') ||
    host === 'paypal.com' ||
    host.endsWith('.paypal.com') ||
    host === 'stripe.com' ||
    host.endsWith('.stripe.com')
  );
}

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'mailto:') {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed navigation requests.
  }
}

function restrictNavigation(event, rawUrl) {
  if (isTrustedNavigation(rawUrl)) return;
  event.preventDefault();
  openExternal(rawUrl);
}

function configureWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isTrustedNavigation(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', restrictNavigation);
  contents.on('will-redirect', restrictNavigation);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05050A',
    icon: `${__dirname}/assets/icon.ico`,
    title: 'Aetheris Computer | AI Workspace',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.removeMenu();
  window.once('ready-to-show', () => window.show());
  void window.loadURL(APP_URL).catch((error) => {
    console.error('[aetheris-desktop] Could not load the Aetheris workspace:', error);
  });
}

app.whenReady().then(() => {
  app.setName('Aetheris Computer');
  app.on('web-contents-created', (_event, contents) => {
    configureWebContents(contents);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
