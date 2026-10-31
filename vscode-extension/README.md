# Aetheris AI for VS Code

Chat with Aetheris AI from a VS Code sidebar. Ask questions about selected
code, request a fix, or generate code without leaving your editor.

## Features

- Stream Aetheris chat replies in the Aetheris activity-bar view.
- Sign in with the same Google or email account used on Aetheris.
- Explain or request a fix for selected code from the editor context menu.
- Generate code from a prompt in the Command Palette.
- Review a code suggestion, then explicitly confirm before it replaces editor
  text.
- Store the revocable sign-in token in VS Code SecretStorage; the extension
  never asks for a Gemini or provider API key.
- The extension is proprietary. Marketplace users may install and use it; the
  source code is not open source.

## Sign in

Open the Aetheris view and choose **Sign in**, or run **Aetheris: Sign In**
from the Command Palette. Your browser opens the Aetheris sign-in page. Once
you authenticate, the one-time callback returns to VS Code. Aetheris stores
only a hash of the 30-day extension token and accepts it only for chat requests.
Sign out from the view title menu or run **Aetheris: Sign Out** to revoke it.

Your prompts and selected-code context are sent to the Aetheris website API,
which currently uses Google Gemini to generate chat responses. Do not send
secrets or sensitive code unless you are comfortable with that processing.
See the [Aetheris Privacy Policy](https://www.aetherisai.me/privacy).

## Install from a VSIX

Download `aetheris-ai-0.1.0.vsix`, then in VS Code run **Extensions: Install
from VSIX...** and select the file. The Marketplace listing can be published
by the Aetheris Marketplace account owner.

## Development

```powershell
npm install
npm run typecheck
npm run compile
npm run package
```

Open this directory in VS Code and press **F5** to launch an Extension
Development Host.

## Commands

| Command | What it does |
| --- | --- |
| Aetheris: Sign In | Link your Aetheris account |
| Aetheris: Sign Out | Revoke this VS Code session |
| Aetheris: Explain Selected Code | Ask for an explanation of the selection |
| Aetheris: Suggest a Fix for Selected Code | Request a replacement suggestion |
| Aetheris: Generate Code | Ask for code to insert or replace a selection |
| Aetheris: Apply Last Code Suggestion | Review and confirm a code edit |
| Aetheris: New Chat | Start a fresh conversation |
