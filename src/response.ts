import jsonpointer from "jsonpointer";

/**
 * Response shaping configuration.
 */
export interface ResponseConfig {
  /** Field mapping: { apiFieldName: db_column_name } */
  fields?: Record<string, string> | undefined;
  /** JSON Pointer for extraction (RFC 6901) */
  returns?: string | undefined;
}

/**
 * Shape query result rows according to response configuration.
 * 1. Apply field mapping to each row
 * 2. Extract using JSON Pointer if specified
 */
export function shapeResponse(
  rows: Record<string, unknown>[],
  config?: ResponseConfig
): unknown {
  // Step 1: Apply field mapping
  let result: unknown = config?.fields
    ? applyFieldMapping(rows, config.fields)
    : rows;

  // Step 2: Apply JSON Pointer extraction
  if (config?.returns) {
    result = jsonpointer.get(result as object, config.returns) ?? null;
  }

  return result;
}

/**
 * Apply field mapping to transform database column names to API field names.
 * fields = { apiFieldName: db_column_name }
 * Unmapped columns are passed through unchanged.
 */
export function applyFieldMapping(
  rows: Record<string, unknown>[],
  fields?: Record<string, string>
): Record<string, unknown>[] {
  if (!fields) return rows;

  // Build reverse mapping: db_column -> apiField
  const reverseMap: Record<string, string> = {};
  for (const [apiField, dbColumn] of Object.entries(fields)) {
    reverseMap[dbColumn] = apiField;
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
