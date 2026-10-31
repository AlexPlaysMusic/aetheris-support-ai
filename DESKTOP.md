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

The website's **Download Windows app** button downloads the latest installer
from the repository's GitHub Releases. Create a GitHub Release by pushing a
version tag such as `v1.0.0`, or run the **Build Windows desktop release**
workflow manually; the workflow builds the installer and publishes both the
versioned file and the stable `Aetheris-AI-Setup-latest-x64.exe` download.

Aetheris AI is a desktop application that securely opens the hosted
Aetheris workspace. An internet connection is required. Sign-in, AI requests,
and billing continue to use the configured Aetheris services; no provider
secrets are included in the installer.

In the desktop app, Google sign-in displays a browser link that can be copied
or opened directly. After Google approves access, the installed app registers
the `aetheris://` sign-in callback and resumes the session. Email sign-in
sends a single-use code to the address entered by the user. Email-code sign-in
requires `RESEND_API_KEY`, `NEXTAUTH_SECRET`, and the Upstash Redis credentials
configured on the hosted Aetheris deployment; Google sign-in also uses Redis
for its short-lived desktop handoff. Credits are read from the shared server
ledger and refreshed after sign-in, when the app returns to the foreground,
and after each chat response.
In Google Cloud OAuth settings, the authorized redirect URI remains
`https://www.aetherisai.me/api/auth/callback/google`.

To run the desktop shell during development:

```powershell
npm run desktop
```

Set `AETHERIS_DESKTOP_URL` only when intentionally testing against another
trusted Aetheris deployment.
