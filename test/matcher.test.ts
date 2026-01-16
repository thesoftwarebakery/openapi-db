import { describe, it, expect } from "vitest";
import { compileRoute, matchRoute } from "../src/matcher.js";
import type { CompiledRoute } from "../src/types.js";

describe("compileRoute", () => {
  it("creates pattern for simple path", () => {
    const route = compileRoute("/users", "get", { query: "SELECT 1" }, []);

    expect(route.method).toBe("get");
    expect(route.pattern.test("/users")).toBe(true);
    expect(route.pattern.test("/users/123")).toBe(false);
    expect(route.paramNames).toEqual([]);
    expect(route.originalPath).toBe("/users");
  });

  it("creates pattern with single path parameter", () => {
    const route = compileRoute("/users/{id}", "get", { query: "SELECT 1" }, []);

    expect(route.pattern.test("/users/123")).toBe(true);
    expect(route.pattern.test("/users/abc")).toBe(true);
    expect(route.pattern.test("/users")).toBe(false);
    expect(route.pattern.test("/users/123/extra")).toBe(false);
    expect(route.paramNames).toEqual(["id"]);
  });

  it("creates pattern with multiple path parameters", () => {
    const route = compileRoute("/users/{userId}/posts/{postId}", "get", { query: "SELECT 1" }, []);

    expect(route.pattern.test("/users/123/posts/456")).toBe(true);
    expect(route.paramNames).toEqual(["userId", "postId"]);
  });

  it("detects $auth usage", () => {
    const routeWithAuth = compileRoute("/users", "get", { query: "WHERE tenant = $auth.tenantId" }, []);
    const routeWithoutAuth = compileRoute("/users", "get", { query: "SELECT 1" }, []);

    expect(routeWithAuth.usesAuth).toBe(true);
    expect(routeWithoutAuth.usesAuth).toBe(false);
  });

  it("preserves xDb and parameters", () => {
    const xDb = { query: "SELECT 1", response: { type: "first" as const } };
    const params = [{ name: "id", in: "path" as const, required: true }];
    const route = compileRoute("/users/{id}", "get", xDb, params);

    expect(route.xDb).toBe(xDb);
    expect(route.parameters).toBe(params);
  });
});

describe("matchRoute", () => {
  const routes: CompiledRoute[] = [
    compileRoute("/users", "get", { query: "SELECT * FROM users" }, []),
    compileRoute("/users", "post", { query: "INSERT INTO users" }, []),
    compileRoute("/users/count", "get", { query: "SELECT COUNT(*)" }, []),
    compileRoute("/users/{id}", "get", { query: "SELECT * FROM users WHERE id = $path.id" }, []),
    compileRoute("/users/{id}", "delete", { query: "DELETE FROM users WHERE id = $path.id" }, []),
  ];

  it("matches exact path with correct method", () => {
    const match = matchRoute(routes, "GET", "/users");

    expect(match).not.toBeNull();
    expect(match?.route.originalPath).toBe("/users");
    expect(match?.route.method).toBe("get");
    expect(match?.pathParams).toEqual({});
  });

  it("matches parameterized path and extracts params", () => {
    const match = matchRoute(routes, "GET", "/users/123");

    expect(match).not.toBeNull();
    expect(match?.route.originalPath).toBe("/users/{id}");
    expect(match?.pathParams).toEqual({ id: "123" });
  });

  it("returns null for non-matching path", () => {
    const match = matchRoute(routes, "GET", "/posts");

    expect(match).toBeNull();
  });

  it("returns null for wrong method", () => {
    const match = matchRoute(routes, "PUT", "/users");

    expect(match).toBeNull();
  });

  it("matches more specific path over parameterized", () => {
    const match = matchRoute(routes, "GET", "/users/count");

    expect(match).not.toBeNull();
    expect(match?.route.originalPath).toBe("/users/count");
  });

  it("normalizes method to lowercase", () => {
    const match = matchRoute(routes, "GET", "/users");

    expect(match?.route.method).toBe("get");
  });

  it("decodes URL-encoded path parameters", () => {
    const match = matchRoute(routes, "GET", "/users/hello%20world");

    expect(match?.pathParams.id).toBe("hello world");
  });
});
