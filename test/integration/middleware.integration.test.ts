import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { openApiDb } from "../../src/frameworks/express.js";
import type { OpenApiSpec } from "../../src/types.js";

describe("openApiDb middleware integration", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: express.Application;

  const spec: OpenApiSpec = {
    openapi: "3.0.3",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          "x-db": {
            query: `
              SELECT id, first_name, last_name, status
              FROM users
              WHERE tenant_id = $auth.tenantId
                AND status = $.default($query.status, 'active')
              ORDER BY first_name
            `,
            response: {
              fields: { firstName: "first_name", lastName: "last_name" },
            },
          },
        },
        post: {
          "x-db": {
            query: `
              INSERT INTO users (id, first_name, last_name, tenant_id, status)
              VALUES ($.uuid(), $body.firstName, $body.lastName, $auth.tenantId, 'active')
              RETURNING id, first_name, last_name, status
            `,
            response: {
              type: "first",
              fields: { firstName: "first_name", lastName: "last_name" },
            },
          },
        },
      },
      "/users/count": {
        get: {
          "x-db": {
            query: `SELECT COUNT(*)::int FROM users WHERE tenant_id = $auth.tenantId`,
            response: { type: "value" },
          },
        },
      },
      "/users/{id}": {
        get: {
          parameters: [{ name: "id", in: "path", required: true }],
          "x-db": {
            query: `
              SELECT id, first_name, last_name, status
              FROM users
              WHERE id = $path.id AND tenant_id = $auth.tenantId
            `,
            response: {
              type: "first",
              fields: { firstName: "first_name", lastName: "last_name" },
            },
          },
        },
        delete: {
          parameters: [{ name: "id", in: "path", required: true }],
          "x-db": {
            query: `
              DELETE FROM users
              WHERE id = $path.id AND tenant_id = $auth.tenantId
              RETURNING id
            `,
            response: { type: "first" },
          },
        },
      },
    },
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();

    pool = new Pool({ connectionString: container.getConnectionUri() });

    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        status TEXT DEFAULT 'active'
      )
    `);

    // Seed test data
    await pool.query(`
      INSERT INTO users (id, first_name, last_name, tenant_id, status) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Alice', 'Smith', 'tenant-1', 'active'),
        ('22222222-2222-2222-2222-222222222222', 'Bob', 'Jones', 'tenant-1', 'active'),
        ('33333333-3333-3333-3333-333333333333', 'Charlie', 'Brown', 'tenant-1', 'inactive'),
        ('44444444-4444-4444-4444-444444444444', 'Dave', 'Wilson', 'tenant-2', 'active')
    `);

    app = express();
    app.use(express.json());
    app.use(
      openApiDb({
        spec,
        db: pool,
        auth: async () => ({ tenantId: "tenant-1" }),
      })
    );
  }, 60000); // 60s timeout for container startup

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  describe("GET /users", () => {
    it("returns users with field mapping applied", async () => {
      const response = await request(app).get("/users").expect(200);

      expect(response.body).toHaveLength(2); // Only active users from tenant-1
      expect(response.body[0]).toHaveProperty("firstName");
      expect(response.body[0]).toHaveProperty("lastName");
      expect(response.body[0]).not.toHaveProperty("first_name");
    });

    it("filters by status query parameter", async () => {
      const response = await request(app)
        .get("/users?status=inactive")
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].firstName).toBe("Charlie");
    });

    it("respects tenant isolation", async () => {
      const response = await request(app).get("/users").expect(200);

      const names = response.body.map((u: { firstName: string }) => u.firstName);
      expect(names).not.toContain("Dave"); // Dave is in tenant-2
    });
  });

  describe("GET /users/:id", () => {
    it("returns single user with field mapping", async () => {
      const response = await request(app)
        .get("/users/11111111-1111-1111-1111-111111111111")
        .expect(200);

      expect(response.body.firstName).toBe("Alice");
      expect(response.body.lastName).toBe("Smith");
    });

    it("returns 404 for non-existent user", async () => {
      const response = await request(app)
        .get("/users/00000000-0000-0000-0000-000000000000")
        .expect(404);

      expect(response.body).toHaveProperty("correlationId");
      expect(response.body.error).toBe("Not Found");
    });

    it("returns 404 for user in different tenant", async () => {
      await request(app)
        .get("/users/44444444-4444-4444-4444-444444444444")
        .expect(404);
    });
  });

  describe("POST /users", () => {
    it("creates user and returns with field mapping", async () => {
      const response = await request(app)
        .post("/users")
        .send({ firstName: "Eve", lastName: "Davis" })
        .expect(200);

      expect(response.body.firstName).toBe("Eve");
      expect(response.body.lastName).toBe("Davis");
      expect(response.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("DELETE /users/:id", () => {
    it("deletes user and returns id", async () => {
      // First create a user to delete
      const created = await request(app)
        .post("/users")
        .send({ firstName: "ToDelete", lastName: "User" });

      const response = await request(app)
        .delete(`/users/${created.body.id}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);

      // Verify user is gone
      await request(app).get(`/users/${created.body.id}`).expect(404);
    });
  });

  describe("GET /users/count", () => {
    it("returns scalar count value", async () => {
      const response = await request(app).get("/users/count").expect(200);

      expect(typeof response.body).toBe("number");
      expect(response.body).toBeGreaterThanOrEqual(2);
    });
  });
});
