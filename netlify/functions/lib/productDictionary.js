function normalizeProductName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDictionaryLookup(dictionary = {}) {
  const lookup = {};

  for (const [canonicalName, entry] of Object.entries(dictionary)) {
    const normalizedCanonical = normalizeProductName(canonicalName);
    if (normalizedCanonical) {
      lookup[normalizedCanonical] = entry;
    }

    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    for (const alias of aliases) {
      const normalizedAlias = normalizeProductName(alias);
      if (normalizedAlias && !lookup[normalizedAlias]) {
        lookup[normalizedAlias] = entry;
      }
    }
  }

  return lookup;
}

export function resolveProductEntries(entries = [], dictionary = {}) {
  const lookup = buildDictionaryLookup(dictionary);

  return entries.map((entry) => {
    const rawName = String(entry.product_name || "").trim();
    const normalizedName = normalizeProductName(rawName);
    const match = lookup[normalizedName];

    if (!match) {
      return {
        ...entry,
        resolution_status: "unknown_product",
        resolved_product_id: "",
        antigens: []
      };
    }

    return {
      ...entry,
      resolution_status: "resolved",
      resolved_product_id: match.product_id || "",
      antigens: Array.isArray(match.antigens) ? match.antigens : []
    };
  });
}
