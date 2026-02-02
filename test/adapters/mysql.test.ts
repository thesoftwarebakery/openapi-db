import { describe, it, expect, vi } from "vitest";
import { MysqlAdapter } from "../../src/adapters/mysql/index.js";
import { createHelpers } from "../../src/helpers.js";
import type { Context } from "../../src/adapters/types.js";

const helpers = createHelpers();

const emptyContext: Context = {
  path: {},
  query: {},
  body: null,
  auth: null,
};

// Mock pool for testing
const createMockPool = () => ({
  execute: vi.fn(),
});

describe("MysqlAdapter", () => {
  describe("validateQuery", () => {
    it("returns valid for string query", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.validateQuery("SELECT * FROM users");
      expect(result).toEqual({ valid: true });
    });

    it("returns invalid for non-string query", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.validateQuery({ collection: "users" });
      expect(result).toEqual({
        valid: false,
        error: "MySQL adapter expects a string query",
      });
    });

    it("returns invalid for null query", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.validateQuery(null);
      expect(result).toEqual({
        valid: false,
        error: "MySQL adapter expects a string query",
      });
    });
  });

  describe("interpolate", () => {
    it("returns plain SQL unchanged with empty values", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.interpolate("SELECT 1", emptyContext, helpers);

      expect(result).toEqual({
        sql: "SELECT 1",
        values: [],
      });
    });

    it("interpolates path variable with ? placeholder", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        path: { id: "123" },
      };
      const result = adapter.interpolate(
        "SELECT * FROM users WHERE id = ${{ path.id }}",
        context,
        helpers
      );

      expect(result).toEqual({
        sql: "SELECT * FROM users WHERE id = ?",
        values: ["123"],
      });
    });

    it("interpolates multiple variables with ? placeholders", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        path: { a: "1" },
        query: { b: "2" },
      };
      const result = adapter.interpolate(
        "WHERE a = ${{ path.a }} AND b = ${{ query.b }}",
        context,
        helpers
      );

      expect(result).toEqual({
        sql: "WHERE a = ? AND b = ?",
        values: ["1", "2"],
      });
    });

    it("interpolates auth variable", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        auth: { tenantId: "tenant-1" },
      };
      const result = adapter.interpolate(
        "WHERE tenant_id = ${{ auth.tenantId }}",
        context,
        helpers
      );

      expect(result).toEqual({
        sql: "WHERE tenant_id = ?",
        values: ["tenant-1"],
      });
    });

    it("interpolates default function with present value", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        query: { status: "pending" },
      };
      const result = adapter.interpolate(
        "WHERE status = ${{ default(query.status, 'active') }}",
        context,
        helpers
      );

      expect(result).toEqual({
        sql: "WHERE status = ?",
        values: ["pending"],
      });
    });

    it("interpolates default function with fallback", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.interpolate(
        "WHERE status = ${{ default(query.status, 'active') }}",
        emptyContext,
        helpers
      );

      expect(result).toEqual({
        sql: "WHERE status = ?",
        values: ["active"],
      });
    });

    it("interpolates uuid function", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const result = adapter.interpolate(
        "INSERT INTO t (id) VALUES (${{ uuid() }})",
        emptyContext,
        helpers
      );

      expect(result.sql).toBe("INSERT INTO t (id) VALUES (?)");
      expect(result.values).toHaveLength(1);
      expect(result.values[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("interpolates now function", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const before = new Date();
      const result = adapter.interpolate(
        "INSERT INTO t (created) VALUES (${{ now() }})",
        emptyContext,
        helpers
      );
      const after = new Date();

      expect(result.sql).toBe("INSERT INTO t (created) VALUES (?)");
      expect(result.values).toHaveLength(1);
      expect(result.values[0]).toBeInstanceOf(Date);

      const date = result.values[0] as Date;
      expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("handles complex template with multiple functions and variables", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        body: { firstName: "Alice", lastName: "Smith" },
        auth: { tenantId: "t123" },
      };
      const template =
        "INSERT INTO users (id, first_name, last_name, tenant_id, created_at) " +
        "VALUES (${{ uuid() }}, ${{ body.firstName }}, ${{ body.lastName }}, ${{ auth.tenantId }}, ${{ now() }})";
      const result = adapter.interpolate(template, context, helpers);

      expect(result.sql).toContain("VALUES (?, ?, ?, ?, ?)");
      expect(result.values).toHaveLength(5);
      expect(result.values[0]).toMatch(/^[0-9a-f-]{36}$/i); // UUID
      expect(result.values[1]).toBe("Alice");
      expect(result.values[2]).toBe("Smith");
      expect(result.values[3]).toBe("t123");
      expect(result.values[4]).toBeInstanceOf(Date);
    });

    it("handles array query parameter", () => {
      const adapter = new MysqlAdapter(createMockPool() as any);
      const context: Context = {
        ...emptyContext,
        query: { ids: "1,2,3" },
      };
      const result = adapter.interpolate(
        "WHERE id IN (${{ query.ids }})",
        context,
        helpers
      );

      expect(result.sql).toBe("WHERE id IN (?)");
      expect(result.values).toEqual([["1", "2", "3"]]);
    });
  });

  describe("execute", () => {
    it("executes query and returns rows", async () => {
      const mockPool = createMockPool();
      mockPool.execute.mockResolvedValue([
        [{ id: 1, name: "Alice" }],
        [], // fields (ignored)
      ]);

      const adapter = new MysqlAdapter(mockPool as any);
      const result = await adapter.execute({
        sql: "SELECT * FROM users WHERE id = ?",
        values: [1],
      });

      expect(mockPool.execute).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?",
        [1]
      );
      expect(result).toEqual([{ id: 1, name: "Alice" }]);
    });

    it("throws OpenApiDbError on query failure", async () => {
      const mockPool = createMockPool();
      mockPool.execute.mockRejectedValue(new Error("Connection refused"));

      const adapter = new MysqlAdapter(mockPool as any);

      await expect(
        adapter.execute({ sql: "SELECT 1", values: [] })
      ).rejects.toMatchObject({
        code: "QUERY_ERROR",
        message: "Connection refused",
        status: 500,
      });
    });
  });
});
