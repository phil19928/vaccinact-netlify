import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { handler } from "../../ops-drill-receiver.js";

async function createTempStorePath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaccinact-ops-drill-"));
  return path.join(directory, "receiver.ndjson");
}

function withEnv(patch, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("ops-drill-receiver stores POST receipts and retrieves them with GET", async () => {
  const storePath = await createTempStorePath();

  await withEnv(
    {
      OPS_DRILL_RECEIVER_STORE_PATH: storePath
    },
    async () => {
      const postResponse = await handler({
        httpMethod: "POST",
        queryStringParameters: { drill_id: "sev1-local-001" },
        headers: {
          "x-vaccinact-event": "officine_matrix_monitor",
          "x-vaccinact-signature": "sha256=abc123"
        },
        body: JSON.stringify({
          summary: { status: "alert" },
          extra_payload: {
            drill: {
              id: "sev1-local-001"
            }
          }
        })
      });
      const postPayload = JSON.parse(postResponse.body);
      assert.equal(postResponse.statusCode, 200);
      assert.equal(postPayload.acknowledged, true);
      assert.equal(postPayload.receipt.drill_id, "sev1-local-001");
      assert.equal(postPayload.receipt.signature_present, true);

      const getResponse = await handler({
        httpMethod: "GET",
        queryStringParameters: { drill_id: "sev1-local-001", limit: "10" },
        body: null
      });
      const getPayload = JSON.parse(getResponse.body);

      assert.equal(getResponse.statusCode, 200);
      assert.equal(getPayload.enabled, true);
      assert.equal(getPayload.total_receipts, 1);
      assert.equal(getPayload.receipts.length, 1);
      assert.equal(getPayload.receipts[0].drill_id, "sev1-local-001");
    }
  );
});

test("ops-drill-receiver deletes receipts by drill_id", async () => {
  const storePath = await createTempStorePath();

  await withEnv(
    {
      OPS_DRILL_RECEIVER_STORE_PATH: storePath
    },
    async () => {
      await handler({
        httpMethod: "POST",
        queryStringParameters: { drill_id: "sev1-local-A" },
        headers: {},
        body: JSON.stringify({ status: "alert" })
      });
      await handler({
        httpMethod: "POST",
        queryStringParameters: { drill_id: "sev1-local-B" },
        headers: {},
        body: JSON.stringify({ status: "alert" })
      });

      const deleteResponse = await handler({
        httpMethod: "DELETE",
        queryStringParameters: { drill_id: "sev1-local-A" },
        body: null
      });
      const deletePayload = JSON.parse(deleteResponse.body);
      assert.equal(deleteResponse.statusCode, 200);
      assert.equal(deletePayload.ok, true);
      assert.equal(deletePayload.deleted_count, 1);

      const getAResponse = await handler({
        httpMethod: "GET",
        queryStringParameters: { drill_id: "sev1-local-A", limit: "10" },
        body: null
      });
      const getAPayload = JSON.parse(getAResponse.body);
      assert.equal(getAPayload.total_receipts, 0);

      const getBResponse = await handler({
        httpMethod: "GET",
        queryStringParameters: { drill_id: "sev1-local-B", limit: "10" },
        body: null
      });
      const getBPayload = JSON.parse(getBResponse.body);
      assert.equal(getBPayload.total_receipts, 1);
    }
  );
});
