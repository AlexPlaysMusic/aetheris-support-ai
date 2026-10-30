const { app, BrowserWindow, shell } = require('electron');

const APP_URL = process.env.AETHERIS_DESKTOP_URL || 'https://www.aetherisai.me';
const APP_HOST = new URL(APP_URL).hostname;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let queuedTicket = process.argv
  .map(extractDesktopTicket)
  .find((ticket) => ticket !== null) ?? null;

if (!gotSingleInstanceLock) app.quit();

function extractDesktopTicket(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'aetheris:' || url.hostname !== 'auth') return null;
    const ticket = url.searchParams.get('ticket');
    return ticket && /^[a-f0-9]{64}$/.test(ticket) ? ticket : null;
  } catch {
    return null;
  }
}

function receiveDesktopUrl(rawUrl) {
  const ticket = extractDesktopTicket(rawUrl);
  if (!ticket) return;
  queuedTicket = ticket;
  if (mainWindow && !mainWindow.isDestroyed()) {
  void mainWindow.loadURL(`${APP_URL}/#desktopTicket=${encodeURIComponent(ticket)}`);
    mainWindow.show();
    mainWindow.focus();
    queuedTicket = null;
  }
}

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
  try {
    const url = new URL(rawUrl);
    if (
      url.hostname.toLowerCase() === APP_HOST &&
      url.pathname === '/desktop-auth/start'
    ) {
      event.preventDefault();
      openExternal(rawUrl);
      return;
    }
  } catch {
    event.preventDefault();
    return;
  }
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05050A',
    icon: `${__dirname}/assets/icon.ico`,
    title: 'Aetheris AI | AI Workspace',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  const initialUrl = queuedTicket
    ? `${APP_URL}/#desktopTicket=${encodeURIComponent(queuedTicket)}`
    : APP_URL;
  queuedTicket = null;
  void mainWindow.loadURL(initialUrl).catch((error) => {
    console.error('[aetheris-desktop] Could not load the Aetheris workspace:', error);
  });
}

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find((argument) => argument.startsWith('aetheris://'));
    if (deepLink) receiveDesktopUrl(deepLink);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    receiveDesktopUrl(url);
  });
  app.whenReady().then(() => {
    app.setAsDefaultProtocolClient('aetheris');
    app.setName('Aetheris AI');
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
}
