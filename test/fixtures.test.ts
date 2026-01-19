import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/parser.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

describe("OpenAPI fixture parsing", () => {
  it("parses test fixture successfully", () => {
    const specPath = path.join(fixturesDir, "openapi.yaml");
    const routes = parseSpec(specPath);

    expect(routes.length).toBeGreaterThan(0);
  });

  it("extracts all routes from fixture", () => {
    const specPath = path.join(fixturesDir, "openapi.yaml");
    const routes = parseSpec(specPath);

    const routeKeys = routes.map((r) => `${r.method} ${r.originalPath}`);

    expect(routeKeys).toContain("get /users");
    expect(routeKeys).toContain("post /users");
    expect(routeKeys).toContain("get /users/{id}");
    expect(routeKeys).toContain("delete /users/{id}");
    expect(routeKeys).toContain("get /users/search");
    expect(routeKeys).toContain("get /stats/user-count");
  });

  it("extracts response configuration", () => {
    const specPath = path.join(fixturesDir, "openapi.yaml");
    const routes = parseSpec(specPath);

    const getUserById = routes.find(
      (r) => r.method === "get" && r.originalPath === "/users/{id}"
    );
    expect(getUserById?.xDb.fields).toEqual({
      firstName: "first_name",
      lastName: "last_name",
      createdAt: "created_at",
    });
    expect(getUserById?.xDb.returns).toBe("/0");

    const getUserCount = routes.find(
      (r) => r.method === "get" && r.originalPath === "/stats/user-count"
    );
    expect(getUserCount?.xDb.returns).toBe("/0/count");
  });

  it("extracts parameters from fixture", () => {
    const specPath = path.join(fixturesDir, "openapi.yaml");
    const routes = parseSpec(specPath);

    const listUsers = routes.find(
      (r) => r.method === "get" && r.originalPath === "/users"
    );
    const paramNames = listUsers?.parameters.map((p) => p.name);

    expect(paramNames).toContain("status");
    expect(paramNames).toContain("limit");
  });
});
