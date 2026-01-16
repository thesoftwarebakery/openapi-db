/**
 * Interpolated SQL query ready for PostgreSQL execution.
 */
export interface InterpolatedSqlQuery {
  sql: string;
  values: unknown[];
}
