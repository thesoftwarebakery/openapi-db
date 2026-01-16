import type { Db, Document } from "mongodb";
import type { Adapter, Context, InterpolationHelpers } from "../types.js";
import type {
  MongoQuery,
  MongoOperationQuery,
  MongoPipelineQuery,
  MongoOperation,
  InterpolatedMongoQuery,
} from "./types.js";
import { OpenApiDbError } from "../../errors.js";

const SUPPORTED_OPERATIONS: MongoOperation[] = [
  "find",
  "findOne",
  "insertOne",
  "updateOne",
  "replaceOne",
  "deleteOne",
  "aggregate",
  "count",
  "findOneAndUpdate",
  "findOneAndDelete",
  "bulkWrite",
];

/**
 * MongoDB adapter using the official mongodb driver.
 * Supports object-based queries and aggregation pipelines.
 */
export class MongoAdapter implements Adapter {
  constructor(private db: Db) {}

  validateQuery(query: unknown): { valid: true } | { valid: false; error: string } {
    if (query === null || typeof query !== "object") {
      return {
        valid: false,
        error: "MongoDB adapter expects an object query",
      };
    }

    const q = query as Record<string, unknown>;

    // Must have collection
    if (typeof q.collection !== "string" || !q.collection) {
      return {
        valid: false,
        error: "MongoDB query must have a 'collection' field (string)",
      };
    }

    // Check for pipeline query
    if ("pipeline" in q) {
      if (!Array.isArray(q.pipeline)) {
        return {
          valid: false,
          error: "MongoDB pipeline must be an array",
        };
      }
      return { valid: true };
    }

    // Must have operation for non-pipeline queries
    if (typeof q.operation !== "string") {
      return {
        valid: false,
        error: "MongoDB query must have either 'operation' or 'pipeline' field",
      };
    }

    if (!SUPPORTED_OPERATIONS.includes(q.operation as MongoOperation)) {
      return {
        valid: false,
        error: `Unknown MongoDB operation: ${q.operation}. Supported: ${SUPPORTED_OPERATIONS.join(", ")}`,
      };
    }

    // Validate required fields for each operation
    const validation = this.validateOperationFields(q.operation as MongoOperation, q);
    if (!validation.valid) {
      return validation;
    }

    return { valid: true };
  }

  private validateOperationFields(
    operation: MongoOperation,
    query: Record<string, unknown>
  ): { valid: true } | { valid: false; error: string } {
    switch (operation) {
      case "insertOne":
        if (!query.document || typeof query.document !== "object") {
          return { valid: false, error: "insertOne requires a 'document' object" };
        }
        break;

      case "updateOne":
      case "findOneAndUpdate":
        if (!query.filter || typeof query.filter !== "object") {
          return { valid: false, error: `${operation} requires a 'filter' object` };
        }
        if (!query.update || typeof query.update !== "object") {
          return { valid: false, error: `${operation} requires an 'update' object` };
        }
        break;

      case "replaceOne":
        if (!query.filter || typeof query.filter !== "object") {
          return { valid: false, error: "replaceOne requires a 'filter' object" };
        }
        if (!query.replacement || typeof query.replacement !== "object") {
          return { valid: false, error: "replaceOne requires a 'replacement' object" };
        }
        break;

      case "deleteOne":
      case "findOneAndDelete":
        if (!query.filter || typeof query.filter !== "object") {
          return { valid: false, error: `${operation} requires a 'filter' object` };
        }
        break;

      case "bulkWrite":
        if (!Array.isArray(query.operations)) {
          return { valid: false, error: "bulkWrite requires an 'operations' array" };
        }
        break;

      // find, findOne, count, aggregate - filter/options are optional
    }

    return { valid: true };
  }

  interpolate(
    query: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): InterpolatedMongoQuery {
    const mongoQuery = query as MongoQuery;
    const interpolated = this.interpolateValue(mongoQuery, context, helpers) as MongoQuery;

    // Handle pipeline query
    if ("pipeline" in interpolated) {
      return this.buildPipelineQuery(interpolated as MongoPipelineQuery);
    }

    // Handle operation query
    return this.buildOperationQuery(interpolated as MongoOperationQuery);
  }

  private buildPipelineQuery(query: MongoPipelineQuery): InterpolatedMongoQuery {
    return {
      collection: query.collection,
      operation: "aggregate",
      args: [query.pipeline, query.options || {}],
    };
  }

  private buildOperationQuery(query: MongoOperationQuery): InterpolatedMongoQuery {
    const { collection, operation, filter, update, replacement, document, operations, options } =
      query;

    let args: unknown[];

    switch (operation) {
      case "find":
        args = [filter || {}, options || {}];
        break;

      case "findOne":
        args = [filter || {}, options || {}];
        break;

      case "insertOne":
        args = [document, options || {}];
        break;

      case "updateOne":
        args = [filter, update, options || {}];
        break;

      case "replaceOne":
        args = [filter, replacement, options || {}];
        break;

      case "deleteOne":
        args = [filter, options || {}];
        break;

      case "aggregate":
        // If using operation: "aggregate" with a filter, treat filter as pipeline
        args = [filter ? [filter] : [], options || {}];
        break;

      case "count":
        args = [filter || {}, options || {}];
        break;

      case "findOneAndUpdate":
        args = [filter, update, options || {}];
        break;

      case "findOneAndDelete":
        args = [filter, options || {}];
        break;

      case "bulkWrite":
        args = [operations, options || {}];
        break;

      default:
        throw new OpenApiDbError(
          "QUERY_ERROR",
          `Unsupported MongoDB operation: ${operation}`,
          500
        );
    }

    return { collection, operation, args };
  }

  /**
   * Recursively interpolate all string values containing ${{ }} in the query object.
   */
  private interpolateValue(
    value: unknown,
    context: Context,
    helpers: InterpolationHelpers
  ): unknown {
    if (typeof value === "string") {
      return this.interpolateString(value, context, helpers);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.interpolateValue(item, context, helpers));
    }

    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.interpolateValue(val, context, helpers);
      }
      return result;
    }

    return value;
  }

  /**
   * Interpolate a string value. If the entire string is a single ${{ }} expression,
   * return the resolved value directly (preserving type). Otherwise, replace all
   * ${{ }} expressions with their string representations.
   */
  private interpolateString(
    template: string,
    context: Context,
    helpers: InterpolationHelpers
  ): unknown {
    const refs = helpers.parseTemplate(template);

    if (refs.length === 0) {
      return template;
    }

    // If the entire string is a single expression, return the value directly (preserving type)
    const firstRef = refs[0];
    if (refs.length === 1 && firstRef && firstRef.start === 0 && firstRef.end === template.length) {
      const isFunction = /^\w+\(/.test(firstRef.inner);
      return isFunction
        ? helpers.evaluateFunction(firstRef.inner, context)
        : helpers.resolveVariable(firstRef.inner, context);
    }

    // Multiple expressions or mixed with text - build string result
    let result = template;
    let offset = 0;

    for (const ref of refs) {
      const isFunction = /^\w+\(/.test(ref.inner);
      const value = isFunction
        ? helpers.evaluateFunction(ref.inner, context)
        : helpers.resolveVariable(ref.inner, context);

      const replacement = String(value ?? "");
      result =
        result.slice(0, ref.start + offset) + replacement + result.slice(ref.end + offset);
      offset += replacement.length - (ref.end - ref.start);
    }

    return result;
  }

  async execute(query: InterpolatedMongoQuery): Promise<Record<string, unknown>[]> {
    const collection = this.db.collection(query.collection);

    try {
      switch (query.operation) {
        case "find": {
          const [filter, options] = query.args as [Document, Document];
          const cursor = collection.find(filter, options);
          return (await cursor.toArray()) as Record<string, unknown>[];
        }

        case "findOne": {
          const [filter, options] = query.args as [Document, Document];
          const doc = await collection.findOne(filter, options);
          return doc ? [doc as Record<string, unknown>] : [];
        }

        case "insertOne": {
          const [document, options] = query.args as [Document, Document];
          const result = await collection.insertOne(document, options);
          return [{ _id: result.insertedId, ...document } as Record<string, unknown>];
        }

        case "updateOne": {
          const [filter, update, options] = query.args as [Document, Document, Document];
          const result = await collection.updateOne(filter, update, options);
          return [
            {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              upsertedId: result.upsertedId,
            },
          ];
        }

        case "replaceOne": {
          const [filter, replacement, options] = query.args as [Document, Document, Document];
          const result = await collection.replaceOne(filter, replacement, options);
          return [
            {
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              upsertedId: result.upsertedId,
            },
          ];
        }

        case "deleteOne": {
          const [filter, options] = query.args as [Document, Document];
          const result = await collection.deleteOne(filter, options);
          return [{ deletedCount: result.deletedCount }];
        }

        case "aggregate": {
          const [pipeline, options] = query.args as [Document[], Document];
          const cursor = collection.aggregate(pipeline, options);
          return (await cursor.toArray()) as Record<string, unknown>[];
        }

        case "count": {
          const [filter, options] = query.args as [Document, Document];
          const count = await collection.countDocuments(filter, options);
          return [{ count }];
        }

        case "findOneAndUpdate": {
          const [filter, update, options] = query.args as [Document, Document, Document];
          const doc = await collection.findOneAndUpdate(filter, update, {
            returnDocument: "after",
            ...options,
          });
          return doc ? [doc as Record<string, unknown>] : [];
        }

        case "findOneAndDelete": {
          const [filter, options] = query.args as [Document, Document];
          const doc = await collection.findOneAndDelete(filter, options);
          return doc ? [doc as Record<string, unknown>] : [];
        }

        case "bulkWrite": {
          const [operations, options] = query.args as [unknown[], Document];
          const result = await collection.bulkWrite(operations as any, options);
          return [
            {
              insertedCount: result.insertedCount,
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              deletedCount: result.deletedCount,
              upsertedCount: result.upsertedCount,
            },
          ];
        }

        default:
          throw new OpenApiDbError(
            "QUERY_ERROR",
            `Unsupported MongoDB operation: ${query.operation}`,
            500
          );
      }
    } catch (error) {
      if (error instanceof OpenApiDbError) {
        throw error;
      }
      throw new OpenApiDbError(
        "QUERY_ERROR",
        error instanceof Error ? error.message : "MongoDB query failed",
        500,
        error
      );
    }
  }
}
