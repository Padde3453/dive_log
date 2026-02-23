# Dive Log

React dashboard + Node API for a Google Sheets-backed dive log.

## Setup
1. Copy `.env.example` to `.env` and fill in your Google Sheets credentials.
2. Start the API server:
   ```bash
   npm run dev:server
   ```
3. Start the React app:
   ```bash
   npm run dev
   ```

## Notes
- The API exposes `GET /api/dives`, `POST /api/dives`, and `PUT /api/dives/:rowNumber`.
- The sheet must have a header row in row 1.
