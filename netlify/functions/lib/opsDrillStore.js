import fs from "node:fs/promises";
import path from "node:path";

function toTrimmedString(value) {
  return String(value || "").trim();
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseIsoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ensureIsoNow(value) {
  const parsed = parseIsoDate(value);
  return parsed ? parsed.toISOString() : new Date().toISOString();
}

async function ensureParentDirectory(filePath) {
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });
}

export function parseOpsDrillStoreLines(rawText = "") {
  const lines = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const receipts = [];
  let parseErrors = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        receipts.push(parsed);
      } else {
        parseErrors += 1;
      }
    } catch {
      parseErrors += 1;
    }
  }

  return {
    total_lines: lines.length,
    parse_errors: parseErrors,
    receipts
  };
}

export async function loadOpsDrillReceipts({
  storePath = "",
  drillId = "",
  limit = 50
} = {}) {
  const normalizedStorePath = toTrimmedString(storePath);
  if (!normalizedStorePath) {
    return {
      enabled: false,
      store_path: "",
      receipts: [],
      parse_errors: 0,
      total_receipts: 0
    };
  }

  let rawText = "";
  try {
    rawText = await fs.readFile(normalizedStorePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        enabled: true,
        store_path: normalizedStorePath,
        receipts: [],
        parse_errors: 0,
        total_receipts: 0
      };
    }
    return {
      enabled: true,
      store_path: normalizedStorePath,
      receipts: [],
      parse_errors: 0,
      total_receipts: 0,
      error: String(error)
    };
  }

  const parsed = parseOpsDrillStoreLines(rawText);
  const normalizedDrillId = toTrimmedString(drillId);
  const maxReceipts = parsePositiveInteger(limit, 50);
  const filtered = normalizedDrillId
    ? parsed.receipts.filter((receipt) => toTrimmedString(receipt?.drill_id) === normalizedDrillId)
    : parsed.receipts;

  const receipts = filtered
    .slice()
    .sort((a, b) => {
      const aTime = parseIsoDate(a?.received_at_iso)?.getTime() || 0;
      const bTime = parseIsoDate(b?.received_at_iso)?.getTime() || 0;
      return bTime - aTime;
    })
    .slice(0, maxReceipts);

  return {
    enabled: true,
    store_path: normalizedStorePath,
    receipts,
    parse_errors: parsed.parse_errors,
    total_receipts: filtered.length
  };
}

export async function appendOpsDrillReceipt({
  storePath = "",
  receipt = {}
} = {}) {
  const normalizedStorePath = toTrimmedString(storePath);
  if (!normalizedStorePath) {
    return {
      enabled: false,
      error: "Missing store path."
    };
  }

  await ensureParentDirectory(normalizedStorePath);
  const normalizedReceipt = {
    received_at_iso: ensureIsoNow(receipt?.received_at_iso),
    receipt_id: toTrimmedString(receipt?.receipt_id),
    drill_id: toTrimmedString(receipt?.drill_id),
    event_name: toTrimmedString(receipt?.event_name),
    request_id: toTrimmedString(receipt?.request_id),
    signature_present: Boolean(receipt?.signature_present),
    payload: receipt?.payload && typeof receipt.payload === "object" ? receipt.payload : {}
  };
  await fs.appendFile(normalizedStorePath, `${JSON.stringify(normalizedReceipt)}\n`, "utf8");

  return {
    enabled: true,
    ok: true,
    store_path: normalizedStorePath,
    receipt: normalizedReceipt
  };
}

export async function deleteOpsDrillReceipts({
  storePath = "",
  drillId = ""
} = {}) {
  const normalizedStorePath = toTrimmedString(storePath);
  if (!normalizedStorePath) {
    return {
      enabled: false,
      error: "Missing store path."
    };
  }

  const normalizedDrillId = toTrimmedString(drillId);
  if (!normalizedDrillId) {
    await ensureParentDirectory(normalizedStorePath);
    await fs.writeFile(normalizedStorePath, "", "utf8");
    return {
      enabled: true,
      ok: true,
      deleted_all: true,
      deleted_count: null,
      store_path: normalizedStorePath
    };
  }

  const loaded = await loadOpsDrillReceipts({
    storePath: normalizedStorePath,
    drillId: "",
    limit: Number.MAX_SAFE_INTEGER
  });
  if (loaded.error) {
    return {
      enabled: true,
      ok: false,
      error: loaded.error,
      store_path: normalizedStorePath
    };
  }

  const keep = loaded.receipts.filter(
    (receipt) => toTrimmedString(receipt?.drill_id) !== normalizedDrillId
  );
  const deletedCount = loaded.receipts.length - keep.length;
  const content = keep.map((receipt) => JSON.stringify(receipt)).join("\n");
  await ensureParentDirectory(normalizedStorePath);
  await fs.writeFile(normalizedStorePath, content ? `${content}\n` : "", "utf8");

  return {
    enabled: true,
    ok: true,
    deleted_all: false,
    deleted_count: deletedCount,
    store_path: normalizedStorePath,
    drill_id: normalizedDrillId
  };
}
