import type { Pool } from "pg";
import type { Adapter, Context, InterpolationHelpers } from "../types.js";
import type { InterpolatedSqlQuery } from "./types.js";
import { OpenApiDbError } from "../../errors.js";

/**
 * PostgreSQL adapter using pg library.
 * Produces parameterized queries with $1, $2, $3 placeholder style.
 */
export class PgAdapter implements Adapter {
  constructor(private pool: Pool) {}

  validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
    if (typeof query !== "string") {
      return {
        valid: false,
        error: "PostgreSQL adapter expects a string query",
      };
    }
    return { valid: true };
  }

  interpolate(
    query: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): InterpolatedSqlQuery {
    const template = query as string;
    const refs = helpers.parseTemplate(template);
    const values: unknown[] = [];
    let sql = template;
    let offset = 0;

    for (const ref of refs) {
      // Determine if it's a function or variable
      const isFunction = /^\w+\(/.test(ref.inner);
      const value = isFunction
        ? helpers.evaluateFunction(ref.inner, context)
        : helpers.resolveVariable(ref.inner, context);

      values.push(value);
      const placeholder = `$${values.length}`;

      // Replace the ${{ ... }} with $N
      sql =
        sql.slice(0, ref.start + offset) +
        placeholder +
        sql.slice(ref.end + offset);
      offset += placeholder.length - (ref.end - ref.start);
    }

    return { sql, values };
  }

  async execute(query: InterpolatedSqlQuery): Promise<Record<string, unknown>[]> {
    try {
      const result = await this.pool.query(query.sql, query.values);
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
}
