import type { Pool, RowDataPacket } from "mysql2/promise";
import type { Adapter, Context, InterpolationHelpers } from "../types.js";
import type { InterpolatedSqlQuery } from "./types.js";
import { OpenApiDbError } from "../../errors.js";

/**
 * MySQL adapter using mysql2 library.
 * Produces parameterized queries with ? placeholder style.
 */
export class MysqlAdapter implements Adapter {
  constructor(private pool: Pool) {}

  validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
    if (typeof query !== "string") {
      return {
        valid: false,
        error: "MySQL adapter expects a string query",
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
      const placeholder = "?";

      // Replace the ${{ ... }} with ?
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
      const [rows] = await this.pool.execute<RowDataPacket[]>(query.sql, query.values);
      return rows as Record<string, unknown>[];
    } catch (error) {
      throw new OpenApiDbError(
        "QUERY_ERROR",
        error instanceof Error ? error.message : "MySQL query failed",
        500,
        error
      );
    }
  }
}
