import type { XDbResponse } from "./types.js";

/**
 * Shape query result rows according to response configuration.
 */
export function shapeResponse(
  rows: Record<string, unknown>[],
  config?: XDbResponse
): unknown {
  const mapped = applyFieldMapping(rows, config?.fields);
  const type = config?.type ?? "array";

  switch (type) {
    case "array":
      return mapped;
    case "first":
      return mapped[0] ?? null;
    case "value": {
      if (mapped.length === 0) return null;
      const firstRow = mapped[0]!;
      const keys = Object.keys(firstRow);
      return keys.length > 0 ? firstRow[keys[0]!] : null;
    }
    default:
      return mapped;
  }
}

/**
 * Apply field mapping to transform SQL column names to API field names.
 * fields = { apiFieldName: sql_column_name }
 */
export function applyFieldMapping(
  rows: Record<string, unknown>[],
  fields?: Record<string, string>
): Record<string, unknown>[] {
  if (!fields) return rows;

  // Build reverse mapping: sql_column -> apiField
  const reverseMap: Record<string, string> = {};
  for (const [apiField, sqlColumn] of Object.entries(fields)) {
    reverseMap[sqlColumn] = apiField;
  }

  return rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const apiKey = reverseMap[key] ?? key;
      mapped[apiKey] = value;
    }
    return mapped;
  });
}
