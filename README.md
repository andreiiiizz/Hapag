# Ulam Finder (Electron)

## 1. Install dependencies
```
npm install
```

## 2. Get a free Gemini API key
Go to https://aistudio.google.com/apikey, sign in with a Google account, and
click "Create API key." No credit card required.

## 3. Add your key
```
cp .env.example .env
```
Open `.env` and paste your real key.

## 4. Run it
```
npm start
```

## 5. Build installers
```
npm run dist:win     # Windows .exe (run this on Windows, or with wine on Linux)
npm run dist:mac      # Mac .app/.dmg (must run this on a Mac)
npm run dist:linux    # Linux AppImage
```
Output goes to the `release/` folder.

## How the API key stays safe
The renderer (the actual app UI, in `renderer/index.html`) never talks to
Google's API directly. It calls `window.electronAPI.callClaude(prompt)`,
which is a bridge (`preload.js`) into the main process (`main.js`) — that's
the only place that reads `GOOGLE_API_KEY` from `.env` and makes the real
request. Never move the `fetch` call into the renderer or the key would ship
inside the app bundle.

## About the free tier
`gemini-2.5-flash` with Google Search grounding gives roughly **1,500
grounded requests per day for free**, then a small per-request charge kicks
in after that. For a personal project this app will realistically never
leave the free tier.

## Notes
- Requires Node 18+ (for built-in `fetch` in the main process).
- `.env` is gitignored — don't commit your real key.
- Cross-platform builds: Windows and Linux targets can usually be built from
  either OS, but a real macOS `.app`/`.dmg` needs to be built on a Mac (Apple's
  toolchain isn't available elsewhere).
- Preview note: this app is designed to run through Electron (`npm start`).
  It won't call the AI from a plain browser tab since there's nowhere secure
  to keep the API key outside the Electron main process.
