# Hosting Aetheris on a laptop (Windows)

Someone asked you to run their Aetheris chat app on your laptop. It takes
about 10 minutes. Leave the laptop on and plugged in while people use it.

## You need from them
1. The GitHub repo link (should look like
   `https://github.com/AlexPlaysMusic/aetheris-support-ai`).
2. Their `.env.local` file contents (secret keys — sent privately, e.g. chat
   DM, **never posted publicly**). You must be able to open the repo link;
   if it 404s, ask them to add you as a collaborator.

## Steps (PowerShell)
1. Install Node.js 20 LTS from https://nodejs.org (accept all defaults),
   then close and reopen PowerShell.
2. Download the code:
   ```powershell
   git clone https://github.com/AlexPlaysMusic/aetheris-support-ai.git
   cd aetheris-support-ai
   ```
   (No `git`? Install it from https://git-scm.com, or use the repo's
   green **Code → Download ZIP** button and unzip it, then `cd` into it.)
3. Install and build:
   ```powershell
   npm install
   npm run build
   ```
4. Create `.env.local` in that folder and paste in the secrets they sent
   you (exact file contents, nothing else needed).
5. Start it:
   ```powershell
   npm run start
   ```
6. Open http://localhost:3000 — the app should load and chat should reply.

## Keep it running 24/7
- Keep the laptop **on, plugged in, and connected to Wi-Fi**. Sleep =
  offline. (Windows Settings → System → Power: set sleep to Never
  while plugged in.)
- If you close the PowerShell window, the site stops. To restart it,
  repeat step 5 in the project folder.
- Optional auto-restart: `npm install -g pm2`, then in the project folder
  `pm2 start ecosystem.config.js` and `pm2 save`.

## Notes
- Chat history lives in each visitor's own browser, and Google sign-in
  works out of the box (the redirect for `localhost:3000` is pre-approved).
- Never share or post the `.env.local` contents — they are passwords.
