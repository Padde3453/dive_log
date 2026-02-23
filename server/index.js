import "dotenv/config";
import express from "express";
import cors from "cors";
import { appendRow, getSheetValues, updateRow } from "./googleSheets.js";

const app = express();
const port = process.env.PORT || 5174;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/dives", async (req, res) => {
  try {
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
    const rowNumber = Number(req.params.rowNumber);
    await updateRow(rowNumber, req.body || {});
    res.json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("PUT /api/dives failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Dive log API listening on http://localhost:${port}`);
});
