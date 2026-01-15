import { describe, it, expect } from "vitest";
import { validateRoutes, type ValidationOptions } from "../src/validation.js";
import type { ParsedRoute } from "../src/types.js";

function makeRoute(overrides: Partial<ParsedRoute> = {}): ParsedRoute {
  return {
    path: "/test",
    originalPath: "/test",
    method: "get",
    xDb: { query: "SELECT 1" },
    parameters: [],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ValidationOptions> = {}): ValidationOptions {
  return { ...overrides };
}

describe("validateRoutes", () => {
  describe("auth validation", () => {
    it("throws when $auth used without auth resolver", () => {
      const routes = [
        makeRoute({
          xDb: { query: "SELECT * FROM users WHERE tenant_id = $auth.tenantId" },
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).toThrow(
        /references \$auth but no auth resolver provided/
      );
    });

    it("passes when $auth used with auth resolver", () => {
      const routes = [
        makeRoute({
          xDb: { query: "SELECT * FROM users WHERE tenant_id = $auth.tenantId" },
        }),
      ];
      const options = makeOptions({ auth: async () => ({ tenantId: "123" }) });

      expect(() => validateRoutes(routes, options)).not.toThrow();
    });

    it("passes when $auth not used", () => {
      const routes = [makeRoute({ xDb: { query: "SELECT * FROM users" } })];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).not.toThrow();
    });
  });

  describe("path parameter validation", () => {
    it("throws when $path references undefined parameter", () => {
      const routes = [
        makeRoute({
          path: "/users/:id",
          originalPath: "/users/{id}",
          xDb: { query: "SELECT * FROM users WHERE id = $path.userId" },
          parameters: [{ name: "id", in: "path", required: true }],
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).toThrow(
        /references \$path\.userId but parameter not defined/
      );
    });

    it("passes when $path references defined parameter", () => {
      const routes = [
        makeRoute({
          path: "/users/:id",
          originalPath: "/users/{id}",
          xDb: { query: "SELECT * FROM users WHERE id = $path.id" },
          parameters: [{ name: "id", in: "path", required: true }],
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).not.toThrow();
    });
  });

  describe("query parameter validation", () => {
    it("throws when $query references undefined parameter", () => {
      const routes = [
        makeRoute({
          xDb: { query: "SELECT * FROM users WHERE status = $query.status" },
          parameters: [],
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).toThrow(
        /references \$query\.status but parameter not defined/
      );
    });

    it("passes when $query references defined parameter", () => {
      const routes = [
        makeRoute({
          xDb: { query: "SELECT * FROM users WHERE status = $query.status" },
          parameters: [{ name: "status", in: "query" }],
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).not.toThrow();
    });
  });

  describe("multiple routes", () => {
    it("validates all routes", () => {
      const routes = [
        makeRoute({ xDb: { query: "SELECT 1" } }),
        makeRoute({
          xDb: { query: "SELECT * FROM users WHERE tenant_id = $auth.tenantId" },
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).toThrow(
        /references \$auth but no auth resolver provided/
      );
    });
  });

  describe("error messages", () => {
    it("includes route method and path in error", () => {
      const routes = [
        makeRoute({
          method: "post",
          originalPath: "/users/{id}",
          xDb: { query: "SELECT * FROM users WHERE tenant_id = $auth.tenantId" },
        }),
      ];
      const options = makeOptions();

      expect(() => validateRoutes(routes, options)).toThrow(
        /POST \/users\/\{id\}/
      );
    });
  });
});
