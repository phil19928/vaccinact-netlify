import test from "node:test";
import assert from "node:assert/strict";

import dictionary from "../../data/product-dictionary.v1.json" with { type: "json" };
import { resolveProductEntries } from "../productDictionary.js";

test("resolveProductEntries resolves canonical and alias names", () => {
  const entries = [
    { product_name: "Gardasil 9", administration_date_iso: "2025-01-01" },
    { product_name: "boostrix tetra", administration_date_iso: "2025-01-05" }
  ];

  const resolved = resolveProductEntries(entries, dictionary);
  assert.equal(resolved[0].resolution_status, "resolved");
  assert.equal(resolved[0].resolved_product_id, "gardasil9");
  assert.deepEqual(resolved[0].antigens, ["HPV"]);

  assert.equal(resolved[1].resolution_status, "resolved");
  assert.equal(resolved[1].resolved_product_id, "boostrixtetra");
  assert.deepEqual(resolved[1].antigens, ["dTcaPolio"]);
});

test("resolveProductEntries returns unknown_product for unmapped names", () => {
  const entries = [{ product_name: "Produit Inconnu XYZ", administration_date_iso: "2025-01-10" }];
  const resolved = resolveProductEntries(entries, dictionary);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].resolution_status, "unknown_product");
  assert.equal(resolved[0].resolved_product_id, "");
  assert.deepEqual(resolved[0].antigens, []);
});
