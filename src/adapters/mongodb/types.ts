/**
 * Supported MongoDB operations.
 */
export type MongoOperation =
  | "find"
  | "findOne"
  | "insertOne"
  | "updateOne"
  | "replaceOne"
  | "deleteOne"
  | "aggregate"
  | "count"
  | "findOneAndUpdate"
  | "findOneAndDelete"
  | "bulkWrite";

/**
 * Query format with explicit operation.
 */
export interface MongoOperationQuery {
  collection: string;
  operation: MongoOperation;
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  replacement?: Record<string, unknown>;
  document?: Record<string, unknown>;
  operations?: unknown[]; // for bulkWrite
  options?: Record<string, unknown>;
}

/**
 * Query format with aggregation pipeline.
 */
export interface MongoPipelineQuery {
  collection: string;
  pipeline: Record<string, unknown>[];
  options?: Record<string, unknown>;
}

/**
 * Union type for all MongoDB query formats.
 */
export type MongoQuery = MongoOperationQuery | MongoPipelineQuery;

/**
 * Interpolated MongoDB query ready for execution.
 */
export interface InterpolatedMongoQuery {
  collection: string;
  operation: string;
  args: unknown[];
}
