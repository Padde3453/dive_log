import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import dotenv from "dotenv";
import {
  appendRow,
  appendRowToSheet,
  getSheetValues,
  getSheetValuesForSheet,
  updateRow,
} from "./googleSheets.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  // eslint-disable-next-line no-console
  console.warn("Failed to load .env from", envPath, envResult.error);
}
const port = process.env.PORT || 5174;
const requiredEnv = [
  "GOOGLE_SHEETS_SPREADSHEET_ID",
];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  // eslint-disable-next-line no-console
  console.warn("Missing env vars:", missingEnv.join(", "));
}
if (
  !process.env.GOOGLE_SHEETS_KEYFILE &&
  (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY)
) {
  // eslint-disable-next-line no-console
  console.warn(
    "Missing Google auth config: set GOOGLE_SHEETS_KEYFILE or GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY."
  );
}
const distPath = path.resolve(__dirname, "../dist");
const hasDist = fs.existsSync(path.join(distPath, "index.html"));
const certificationsSheetName =
  process.env.GOOGLE_SHEETS_CERTIFICATIONS_SHEET_NAME || "Certifications";

app.use(cors());
app.use(express.json());

const authUser = process.env.APP_BASIC_AUTH_USER;
const authPass = process.env.APP_BASIC_AUTH_PASS;
const sessionSecret = process.env.APP_SESSION_SECRET || "dive-log-session";
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 14;
const viewToken = process.env.APP_VIEW_TOKEN || "";

const parseCookies = (cookieHeader = "") =>
  cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split("=");
      acc[key] = decodeURIComponent(rest.join("="));
      return acc;
    }, {});

const signToken = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
};

const verifyToken = (token) => {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.iat) return null;
    if (Date.now() - payload.iat > sessionMaxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
};

const isAuthenticated = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies["dive_log_session"];
  return Boolean(verifyToken(token));
};

const hasValidViewToken = (req) => {
  if (!viewToken) return false;
  const incoming = String(req.query?.viewToken || "").trim();
  return Boolean(incoming) && incoming === viewToken;
};

const canRead = (req) => isAuthenticated(req) || hasValidViewToken(req);

const requireAuth = (req, res, next) => {
  if (!authUser || !authPass) return next();
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: "Unauthorized" });
};

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const authenticated = isAuthenticated(req);
  res.json({ authenticated, viewOnly: !authenticated && hasValidViewToken(req) });
});

app.get("/api/view-link", (req, res) => {
  if (!viewToken) {
    return res.json({ url: "" });
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const url = `${proto}://${host}/?viewToken=${encodeURIComponent(viewToken)}`;
  return res.json({ url });
});

app.post("/api/login", (req, res) => {
  if (!authUser || !authPass) {
    return res.status(400).json({ error: "Auth not configured." });
  }

  const { username, password } = req.body || {};
  if (username !== authUser || password !== authPass) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = signToken({ user: authUser, iat: Date.now() });

  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `dive_log_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${
      secure ? "; Secure" : ""
    }`
  );
  return res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader(
    "Set-Cookie",
    "dive_log_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
  return res.json({ ok: true });
});

app.get("/api/dives", async (req, res) => {
  try {
    if ((authUser && authPass) && !canRead(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const data = await getSheetValues();
    res.json(data);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("GET /api/dives failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/dives", async (req, res) => {
  try {
    if (authUser && authPass && !isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    await appendRow(req.body || {});
    res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("POST /api/dives failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/dives/:rowNumber", async (req, res) => {
  try {
    if (authUser && authPass && !isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const rowNumber = Number(req.params.rowNumber);
    await updateRow(rowNumber, req.body || {});
    res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("PUT /api/dives failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/certifications", async (req, res) => {
  try {
    if ((authUser && authPass) && !canRead(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const data = await getSheetValuesForSheet(certificationsSheetName);
    return res.json(data);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("GET /api/certifications failed:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/certifications", async (req, res) => {
  try {
    if (authUser && authPass && !isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    await appendRowToSheet(certificationsSheetName, req.body || {});
    return res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("POST /api/certifications failed:", error);
    return res.status(500).json({ error: error.message });
  }
});

if (hasDist) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Dive log API listening on http://localhost:${port}`);
});
