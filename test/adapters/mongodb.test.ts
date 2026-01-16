import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoAdapter } from "../../src/adapters/mongodb/index.js";
import { createHelpers } from "../../src/helpers.js";
import type { Context } from "../../src/adapters/types.js";

const helpers = createHelpers();

const emptyContext: Context = {
  path: {},
  query: {},
  body: null,
  auth: null,
};

// Mock MongoDB collection and db
const createMockCollection = () => ({
  find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  findOne: vi.fn().mockResolvedValue(null),
  insertOne: vi.fn().mockResolvedValue({ insertedId: "new-id" }),
  updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  replaceOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  countDocuments: vi.fn().mockResolvedValue(0),
  findOneAndUpdate: vi.fn().mockResolvedValue(null),
  findOneAndDelete: vi.fn().mockResolvedValue(null),
  bulkWrite: vi.fn().mockResolvedValue({
    insertedCount: 0,
    matchedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    upsertedCount: 0,
  }),
});

const createMockDb = (collection = createMockCollection()) => ({
  collection: vi.fn().mockReturnValue(collection),
});

describe("MongoAdapter", () => {
  describe("validateQuery", () => {
    it("returns invalid for non-object query", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(adapter.validateQuery("SELECT * FROM users")).toEqual({
        valid: false,
        error: "MongoDB adapter expects an object query",
      });
    });

    it("returns invalid for null query", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(adapter.validateQuery(null)).toEqual({
        valid: false,
        error: "MongoDB adapter expects an object query",
      });
    });

    it("returns invalid when collection is missing", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(adapter.validateQuery({ operation: "find" })).toEqual({
        valid: false,
        error: "MongoDB query must have a 'collection' field (string)",
      });
    });

    it("returns invalid when neither operation nor pipeline is present", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(adapter.validateQuery({ collection: "users" })).toEqual({
        valid: false,
        error: "MongoDB query must have either 'operation' or 'pipeline' field",
      });
    });

    it("returns invalid for unknown operation", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(adapter.validateQuery({ collection: "users", operation: "unknownOp" })).toEqual({
        valid: false,
        error: expect.stringContaining("Unknown MongoDB operation: unknownOp"),
      });
    });

    it("returns valid for find operation", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "find",
          filter: { status: "active" },
        })
      ).toEqual({ valid: true });
    });

    it("returns valid for pipeline query", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          pipeline: [{ $match: { status: "active" } }],
        })
      ).toEqual({ valid: true });
    });

    it("returns invalid when pipeline is not an array", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          pipeline: { $match: { status: "active" } },
        })
      ).toEqual({
        valid: false,
        error: "MongoDB pipeline must be an array",
      });
    });

    it("returns invalid for insertOne without document", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "insertOne",
        })
      ).toEqual({
        valid: false,
        error: "insertOne requires a 'document' object",
      });
    });

    it("returns invalid for updateOne without filter", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "updateOne",
          update: { $set: { status: "active" } },
        })
      ).toEqual({
        valid: false,
        error: "updateOne requires a 'filter' object",
      });
    });

    it("returns invalid for updateOne without update", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "updateOne",
          filter: { _id: "123" },
        })
      ).toEqual({
        valid: false,
        error: "updateOne requires an 'update' object",
      });
    });

    it("returns invalid for deleteOne without filter", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "deleteOne",
        })
      ).toEqual({
        valid: false,
        error: "deleteOne requires a 'filter' object",
      });
    });

    it("returns invalid for bulkWrite without operations", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      expect(
        adapter.validateQuery({
          collection: "users",
          operation: "bulkWrite",
        })
      ).toEqual({
        valid: false,
        error: "bulkWrite requires an 'operations' array",
      });
    });
  });

  describe("interpolate", () => {
    it("returns query unchanged when no variables present", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const query = {
        collection: "users",
        operation: "find",
        filter: { status: "active" },
      };
      const result = adapter.interpolate(query, emptyContext, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "find",
        args: [{ status: "active" }, {}],
      });
    });

    it("interpolates path variable in filter", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        path: { id: "user-123" },
      };
      const query = {
        collection: "users",
        operation: "findOne",
        filter: { _id: "${{ path.id }}" },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "findOne",
        args: [{ _id: "user-123" }, {}],
      });
    });

    it("interpolates auth variable", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        auth: { tenantId: "tenant-1" },
      };
      const query = {
        collection: "users",
        operation: "find",
        filter: { tenant_id: "${{ auth.tenantId }}" },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "find",
        args: [{ tenant_id: "tenant-1" }, {}],
      });
    });

    it("interpolates default function with present value", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        query: { status: "pending" },
      };
      const query = {
        collection: "users",
        operation: "find",
        filter: { status: "${{ default(query.status, 'active') }}" },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "find",
        args: [{ status: "pending" }, {}],
      });
    });

    it("interpolates default function with fallback", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const query = {
        collection: "users",
        operation: "find",
        filter: { status: "${{ default(query.status, 'active') }}" },
      };
      const result = adapter.interpolate(query, emptyContext, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "find",
        args: [{ status: "active" }, {}],
      });
    });

    it("interpolates uuid function", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const query = {
        collection: "users",
        operation: "insertOne",
        document: { _id: "${{ uuid() }}", name: "Alice" },
      };
      const result = adapter.interpolate(query, emptyContext, helpers);

      expect(result.collection).toBe("users");
      expect(result.operation).toBe("insertOne");
      expect((result.args[0] as any)._id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect((result.args[0] as any).name).toBe("Alice");
    });

    it("interpolates now function", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const before = new Date();
      const query = {
        collection: "users",
        operation: "insertOne",
        document: { created_at: "${{ now() }}" },
      };
      const result = adapter.interpolate(query, emptyContext, helpers);
      const after = new Date();

      const createdAt = (result.args[0] as any).created_at as Date;
      expect(createdAt).toBeInstanceOf(Date);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("interpolates nested object values", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        body: { user: { name: "Alice", email: "alice@test.com" } },
      };
      const query = {
        collection: "users",
        operation: "insertOne",
        document: {
          name: "${{ body.user.name }}",
          email: "${{ body.user.email }}",
        },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect((result.args[0] as any).name).toBe("Alice");
      expect((result.args[0] as any).email).toBe("alice@test.com");
    });

    it("interpolates array values", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        path: { id: "123" },
        auth: { tenantId: "t1" },
      };
      const query = {
        collection: "users",
        pipeline: [
          { $match: { _id: "${{ path.id }}", tenant_id: "${{ auth.tenantId }}" } },
          { $project: { name: 1 } },
        ],
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result.operation).toBe("aggregate");
      expect(result.args[0]).toEqual([
        { $match: { _id: "123", tenant_id: "t1" } },
        { $project: { name: 1 } },
      ]);
    });

    it("preserves numeric values when interpolating entire expression", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        query: { limit: "10" },
      };
      const query = {
        collection: "users",
        operation: "find",
        filter: {},
        options: { limit: "${{ default(query.limit, 20) }}" },
      };
      const result = adapter.interpolate(query, context, helpers);

      // The value should be preserved as string "10" (from query param)
      expect((result.args[1] as any).limit).toBe("10");
    });

    it("handles mixed text and expressions in strings", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        path: { name: "alice" },
      };
      const query = {
        collection: "users",
        operation: "find",
        filter: { email: "${{ path.name }}@example.com" },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect((result.args[0] as any).email).toBe("alice@example.com");
    });

    it("builds correct args for updateOne", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        path: { id: "123" },
        body: { status: "active" },
      };
      const query = {
        collection: "users",
        operation: "updateOne",
        filter: { _id: "${{ path.id }}" },
        update: { $set: { status: "${{ body.status }}" } },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "updateOne",
        args: [{ _id: "123" }, { $set: { status: "active" } }, {}],
      });
    });

    it("builds correct args for deleteOne", () => {
      const adapter = new MongoAdapter(createMockDb() as any);
      const context: Context = {
        ...emptyContext,
        path: { id: "123" },
      };
      const query = {
        collection: "users",
        operation: "deleteOne",
        filter: { _id: "${{ path.id }}" },
      };
      const result = adapter.interpolate(query, context, helpers);

      expect(result).toEqual({
        collection: "users",
        operation: "deleteOne",
        args: [{ _id: "123" }, {}],
      });
    });
  });

  describe("execute", () => {
    let mockCollection: ReturnType<typeof createMockCollection>;
    let mockDb: ReturnType<typeof createMockDb>;

    beforeEach(() => {
      mockCollection = createMockCollection();
      mockDb = createMockDb(mockCollection);
    });

    it("executes find and returns rows", async () => {
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: "1", name: "Alice" }]),
      });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "find",
        args: [{ status: "active" }, {}],
      });

      expect(mockDb.collection).toHaveBeenCalledWith("users");
      expect(mockCollection.find).toHaveBeenCalledWith({ status: "active" }, {});
      expect(result).toEqual([{ _id: "1", name: "Alice" }]);
    });

    it("executes findOne and returns single document as array", async () => {
      mockCollection.findOne.mockResolvedValue({ _id: "1", name: "Alice" });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "findOne",
        args: [{ _id: "1" }, {}],
      });

      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: "1" }, {});
      expect(result).toEqual([{ _id: "1", name: "Alice" }]);
    });

    it("executes findOne and returns empty array when not found", async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "findOne",
        args: [{ _id: "nonexistent" }, {}],
      });

      expect(result).toEqual([]);
    });

    it("executes insertOne and returns document with _id", async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: "new-id-123" });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "insertOne",
        args: [{ name: "Alice" }, {}],
      });

      expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: "Alice" }, {});
      expect(result).toEqual([{ _id: "new-id-123", name: "Alice" }]);
    });

    it("executes updateOne and returns result stats", async () => {
      mockCollection.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
        upsertedId: null,
      });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "updateOne",
        args: [{ _id: "1" }, { $set: { name: "Bob" } }, {}],
      });

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: "1" },
        { $set: { name: "Bob" } },
        {}
      );
      expect(result).toEqual([{ matchedCount: 1, modifiedCount: 1, upsertedId: null }]);
    });

    it("executes deleteOne and returns deletedCount", async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "deleteOne",
        args: [{ _id: "1" }, {}],
      });

      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: "1" }, {});
      expect(result).toEqual([{ deletedCount: 1 }]);
    });

    it("executes aggregate and returns results", async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: "status", count: 5 }]),
      });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "aggregate",
        args: [[{ $group: { _id: "$status", count: { $sum: 1 } } }], {}],
      });

      expect(mockCollection.aggregate).toHaveBeenCalledWith(
        [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        {}
      );
      expect(result).toEqual([{ _id: "status", count: 5 }]);
    });

    it("executes count and returns count object", async () => {
      mockCollection.countDocuments.mockResolvedValue(42);

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "count",
        args: [{ status: "active" }, {}],
      });

      expect(mockCollection.countDocuments).toHaveBeenCalledWith({ status: "active" }, {});
      expect(result).toEqual([{ count: 42 }]);
    });

    it("executes findOneAndUpdate with returnDocument: after", async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({ _id: "1", name: "Updated" });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "findOneAndUpdate",
        args: [{ _id: "1" }, { $set: { name: "Updated" } }, {}],
      });

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "1" },
        { $set: { name: "Updated" } },
        { returnDocument: "after" }
      );
      expect(result).toEqual([{ _id: "1", name: "Updated" }]);
    });

    it("executes findOneAndDelete", async () => {
      mockCollection.findOneAndDelete.mockResolvedValue({ _id: "1", name: "Deleted" });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "findOneAndDelete",
        args: [{ _id: "1" }, {}],
      });

      expect(mockCollection.findOneAndDelete).toHaveBeenCalledWith({ _id: "1" }, {});
      expect(result).toEqual([{ _id: "1", name: "Deleted" }]);
    });

    it("executes bulkWrite and returns result stats", async () => {
      mockCollection.bulkWrite.mockResolvedValue({
        insertedCount: 1,
        matchedCount: 2,
        modifiedCount: 2,
        deletedCount: 1,
        upsertedCount: 0,
      });

      const adapter = new MongoAdapter(mockDb as any);
      const result = await adapter.execute({
        collection: "users",
        operation: "bulkWrite",
        args: [
          [{ insertOne: { document: { name: "Alice" } } }, { deleteOne: { filter: { _id: "1" } } }],
          {},
        ],
      });

      expect(result).toEqual([
        {
          insertedCount: 1,
          matchedCount: 2,
          modifiedCount: 2,
          deletedCount: 1,
          upsertedCount: 0,
        },
      ]);
    });

    it("throws OpenApiDbError on query failure", async () => {
      mockCollection.find.mockReturnValue({
        toArray: vi.fn().mockRejectedValue(new Error("Connection refused")),
      });

      const adapter = new MongoAdapter(mockDb as any);

      await expect(
        adapter.execute({
          collection: "users",
          operation: "find",
          args: [{}, {}],
        })
      ).rejects.toMatchObject({
        code: "QUERY_ERROR",
        message: "Connection refused",
        status: 500,
      });
    });
  });
});
