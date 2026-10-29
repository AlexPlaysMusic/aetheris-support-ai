# Aetheris Computer for Windows

The Windows installer is built with:

```powershell
npm install
npm run desktop:installer
```

The installer is written to
`release-installer/Aetheris-Computer-Setup-1.0.0-x64.exe`.
It creates Start menu and desktop shortcuts and installs for the current
Windows user.

Aetheris Computer is a desktop application that securely opens the hosted
Aetheris workspace. An internet connection is required. Sign-in, AI requests,
and billing continue to use the configured Aetheris services; no provider
secrets are included in the installer.

To run the desktop shell during development:

```powershell
npm run desktop
```

Set `AETHERIS_DESKTOP_URL` only when intentionally testing against another
trusted Aetheris deployment.
