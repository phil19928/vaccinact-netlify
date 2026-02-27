import crypto from "node:crypto";

import {
  appendOpsDrillReceipt,
  deleteOpsDrillReceipts,
  loadOpsDrillReceipts
} from "./lib/opsDrillStore.js";

function toTrimmedString(value) {
  return String(value || "").trim();
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function resolveDrillId({ query = {}, body = {} } = {}) {
  const queryDrillId = toTrimmedString(query.drill_id);
  if (queryDrillId) return queryDrillId;

  const bodyDrillId = toTrimmedString(body?.drill_id);
  if (bodyDrillId) return bodyDrillId;

  const payloadDrillId = toTrimmedString(body?.extra_payload?.drill?.id);
  if (payloadDrillId) return payloadDrillId;

  return "unspecified";
}

function resolveStorePath() {
  const configuredPath = toTrimmedString(process.env.OPS_DRILL_RECEIVER_STORE_PATH);
  if (configuredPath) return configuredPath;
  return ".netlify/ops-drill-receiver.ndjson";
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST" && event.httpMethod !== "DELETE") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const query = event.queryStringParameters || {};
    const parsedBody = event.body ? JSON.parse(event.body) : {};
    const storePath = resolveStorePath();

    if (event.httpMethod === "GET") {
      const drillId = toTrimmedString(query.drill_id);
      const limit = parsePositiveInteger(query.limit, 20);
      const loaded = await loadOpsDrillReceipts({
        storePath,
        drillId,
        limit
      });
      const statusCode = loaded.error ? 500 : 200;
      return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loaded)
      };
    }

    if (event.httpMethod === "DELETE") {
      const drillId = toTrimmedString(query.drill_id || parsedBody?.drill_id);
      const deleted = await deleteOpsDrillReceipts({
        storePath,
        drillId
      });
      const statusCode = deleted.ok === false ? 500 : 200;
      return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deleted)
      };
    }

    const requestId =
      event?.headers?.["x-nf-request-id"] ||
      event?.headers?.["X-Nf-Request-Id"] ||
      event?.headers?.["x-request-id"] ||
      event?.headers?.["X-Request-Id"] ||
      "";
    const eventName =
      event?.headers?.["x-vaccinact-event"] ||
      event?.headers?.["X-VaccinAct-Event"] ||
      "unknown_event";
    const signature =
      event?.headers?.["x-vaccinact-signature"] ||
      event?.headers?.["X-VaccinAct-Signature"] ||
      "";

    const drillId = resolveDrillId({
      query,
      body: parsedBody
    });
    const receiptId = `drill_rcpt_${crypto.randomUUID()}`;
    const appended = await appendOpsDrillReceipt({
      storePath,
      receipt: {
        received_at_iso: new Date().toISOString(),
        receipt_id: receiptId,
        drill_id: drillId,
        event_name: eventName,
        request_id: requestId,
        signature_present: Boolean(toTrimmedString(signature)),
        payload: parsedBody
      }
    });
    const statusCode = appended.ok === false ? 500 : 200;
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(appended || {}),
        receipt_id: receiptId,
        acknowledged: appended.ok !== false
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: String(error)
      })
    };
  }
};
