/**
 * Interpolated SQL query ready for MySQL execution.
 */
export interface InterpolatedSqlQuery {
  sql: string;
  values: unknown[];
}
