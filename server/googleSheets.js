import { google } from "googleapis";
import fs from "node:fs";

const required = ["GOOGLE_SHEETS_SPREADSHEET_ID"];

function getEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }

  const keyFile = process.env.GOOGLE_SHEETS_KEYFILE;
  if (keyFile) {
    const raw = fs.readFileSync(keyFile, "utf8");
    const json = JSON.parse(raw);

    if (!json.client_email || !json.private_key) {
      throw new Error("Invalid keyfile: missing client_email/private_key.");
    }

    return {
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      clientEmail: json.client_email,
      privateKey: json.private_key,
      sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || "Sheet1",
      range: process.env.GOOGLE_SHEETS_RANGE,
    };
  }

  if (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
    throw new Error(
      "Missing GOOGLE_SHEETS_CLIENT_EMAIL/GOOGLE_SHEETS_PRIVATE_KEY or GOOGLE_SHEETS_KEYFILE."
    );
  }

  return {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    clientEmail: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, "\n"),
    sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || "Sheet1",
    range: process.env.GOOGLE_SHEETS_RANGE,
  };
}

function getAuthClient() {
  const { clientEmail, privateKey } = getEnv();

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

function normalizeKey(key) {
  return String(key || "").trim().toLowerCase();
}

function buildRowFromHeaders(headers, data) {
  const normalizedData = new Map(
    Object.entries(data || {}).map(([key, value]) => [normalizeKey(key), value])
  );
  return headers.map((header) => {
    if (Object.prototype.hasOwnProperty.call(data || {}, header)) {
      return data[header] ?? "";
    }
    const normalizedHeader = normalizeKey(header);
    return normalizedData.get(normalizedHeader) ?? "";
  });
}

function buildRows(values) {
  const headers = values[0] || [];
  const rows = values.slice(1).map((row, index) => {
    const obj = { _rowNumber: index + 2 };
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

function columnLetter(index) {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function getSheetValues() {
  const { spreadsheetId, sheetName, range } = getEnv();
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: range || `${sheetName}!A1:Z1000`,
  });

  return buildRows(response.data.values || []);
}

export async function getSheetValuesForSheet(sheetName, range = "A1:Z1000") {
  const { spreadsheetId } = getEnv();
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${range}`,
  });
  return buildRows(response.data.values || []);
}

export async function appendRow(data) {
  const { spreadsheetId, sheetName } = getEnv();
  const sheets = getSheetsClient();

  const { headers } = await getSheetValues();
  if (headers.length === 0) {
    throw new Error("Sheet has no header row.");
  }

  const row = buildRowFromHeaders(headers, data);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1:Z1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });
}

export async function appendRowToSheet(sheetName, data) {
  const { spreadsheetId } = getEnv();
  const sheets = getSheetsClient();
  const { headers } = await getSheetValuesForSheet(sheetName);
  if (headers.length === 0) {
    throw new Error("Sheet has no header row.");
  }
  const row = buildRowFromHeaders(headers, data);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1:Z1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function updateRow(rowNumber, data) {
  const { spreadsheetId, sheetName } = getEnv();
  const sheets = getSheetsClient();

  if (rowNumber < 2) {
    throw new Error("Row number must be >= 2 (row 1 is headers).");
  }

  const { headers } = await getSheetValues();
  if (headers.length === 0) {
    throw new Error("Sheet has no header row.");
  }

  const row = buildRowFromHeaders(headers, data);
  const endColumn = columnLetter(Math.max(headers.length - 1, 0));

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowNumber}:${endColumn}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}
