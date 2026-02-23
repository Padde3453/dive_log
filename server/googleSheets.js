import { google } from "googleapis";

const required = [
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_SHEETS_CLIENT_EMAIL",
  "GOOGLE_SHEETS_PRIVATE_KEY",
];

function getEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
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
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: range || `${sheetName}!A1:Z1000`,
  });

  const values = response.data.values || [];
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

export async function appendRow(data) {
  const { spreadsheetId, sheetName } = getEnv();
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const { headers } = await getSheetValues();
  if (headers.length === 0) {
    throw new Error("Sheet has no header row.");
  }

  const row = headers.map((header) => data[header] ?? "");

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

export async function updateRow(rowNumber, data) {
  const { spreadsheetId, sheetName } = getEnv();
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  if (rowNumber < 2) {
    throw new Error("Row number must be >= 2 (row 1 is headers).");
  }

  const { headers } = await getSheetValues();
  if (headers.length === 0) {
    throw new Error("Sheet has no header row.");
  }

  const row = headers.map((header) => data[header] ?? "");
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
