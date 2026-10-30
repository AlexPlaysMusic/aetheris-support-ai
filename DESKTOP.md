# Aetheris AI for Windows

The Windows installer is built with:

```powershell
npm install
npm run desktop:installer
```

The installer is written to
`release-installer/Aetheris-AI-Setup-1.0.0-x64.exe`.
It creates Start menu and desktop shortcuts and installs for the current
Windows user.

Aetheris AI is a desktop application that securely opens the hosted
Aetheris workspace. An internet connection is required. Sign-in, AI requests,
and billing continue to use the configured Aetheris services; no provider
secrets are included in the installer.

Google sign-in opens in the system browser and returns to Aetheris AI.
The installed app registers the `aetheris://` sign-in callback. Email sign-in
sends a single-use code to the address entered by the user. Email-code sign-in
requires `RESEND_API_KEY`, `NEXTAUTH_SECRET`, and the Upstash Redis credentials
configured on the hosted Aetheris deployment; Google sign-in also uses Redis
for its short-lived desktop handoff.
In Google Cloud OAuth settings, the authorized redirect URI remains
`https://www.aetherisai.me/api/auth/callback/google`.

To run the desktop shell during development:

```powershell
npm run desktop
```

Set `AETHERIS_DESKTOP_URL` only when intentionally testing against another
trusted Aetheris deployment.
