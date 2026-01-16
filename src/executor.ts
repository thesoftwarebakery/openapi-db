import type { Pool } from "pg";
import { OpenApiDbError } from "./errors.js";

/**
 * Execute a parameterized SQL query and return the rows.
 */
export async function executeQuery(
  pool: Pool,
  sql: string,
  values: unknown[]
): Promise<Record<string, unknown>[]> {
  try {
    const result = await pool.query(sql, values);
    return result.rows;
  } catch (error) {
    throw new OpenApiDbError(
      "QUERY_ERROR",
      error instanceof Error ? error.message : "Database query failed",
      500,
      error
    );
  }
}
