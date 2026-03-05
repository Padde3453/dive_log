# Dive Log (Simple Starter Guide)

This app has two parts:
- **API server** (talks to Google Sheets)
- **Web app** (the dashboard)

You can start both with **one command**.

---

## 1) First-time setup (one time only)

Open Terminal and run:

```bash
cd "/Users/patrickr/Documents/VS Code/Dive_log"
npm install
```

---

## 2) Create your .env file (one time only)

Copy the example file:

```bash
cd "/Users/patrickr/Documents/VS Code/Dive_log"
cp .env.example .env
```

Open `.env` and make sure it has these values (example):

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=1HTMYVs82ODjfngeUWEo-jqlH-3uTPASp3O5nRJSzvT8
GOOGLE_SHEETS_SHEET_NAME=Data
GOOGLE_SHEETS_KEYFILE="/Users/patrickr/Documents/VS Code/Credentials/crux-consulting-460513-91961c82c612.json"
PORT=5176

# Login for local app
APP_BASIC_AUTH_USER=patrick
APP_BASIC_AUTH_PASS=patrici
APP_SESSION_SECRET=local-dev-secret
```

---

## 3) Start everything (one command)

```bash
cd "/Users/patrickr/Documents/VS Code/Dive_log"
npm run dev:all
```

This starts:
- API server on **http://localhost:5176**
- Web app on **http://localhost:5174**

Open this in your browser:

```
http://localhost:5174
```

Login with:
- **Username**: `patrick`
- **Password**: `patrici`

---

## If you only want to run one part

API only:
```bash
npm run dev:server
```

Web only:
```bash
npm run dev
```

---

## Common problems

**"Cannot GET /"**
- This means you are visiting the API server URL (5176). The web app is at 5174.

**Google Sheets permission error**
- Make sure the sheet is shared with your service account email.

**Nothing updates**
- Refresh the page. This app loads data on page load (not live).

---

## Production (Render)

- Render uses its own environment variables (does not use your local `.env`).
- After you push code to GitHub, Render auto-deploys.

