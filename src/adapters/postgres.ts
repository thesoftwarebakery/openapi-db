import type { Pool, QueryResult } from "pg";
import type { XDbResponse } from "../types.js";

export interface ExecuteOptions {
  sql: string;
  values: unknown[];
  response?: XDbResponse | undefined;
}

/**
 * Execute a parameterized query and shape the response.
 */
export async function executeQuery(
  pool: Pool,
  options: ExecuteOptions
): Promise<unknown> {
  const result = await pool.query(options.sql, options.values);
  return shapeResponse(result, options.response);
}

/**
 * Shape the query result according to response configuration.
 */
export function shapeResponse(
  result: QueryResult,
  response?: XDbResponse
): unknown {
  const rows = applyFieldMapping(result.rows, response?.fields);
  const type = response?.type ?? "array";

  switch (type) {
    case "array":
      return rows;
    case "first":
      return rows[0] ?? null;
    case "value": {
      if (rows.length === 0) return null;
      const firstRow = rows[0]!;
      const keys = Object.keys(firstRow);
      return keys.length > 0 ? firstRow[keys[0]!] : null;
    }
    default:
      return rows;
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
