import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import mysql from "mysql2/promise";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, OpenApiDbError, MysqlAdapter, type Router } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures-mysql");

const specPath = path.join(fixturesDir, "openapi.yaml");
const schemaPath = path.join(fixturesDir, "schema.sql");
const seedPath = path.join(fixturesDir, "seed.sql");

describe("MysqlAdapter integration", () => {
  let container: StartedMySqlContainer;
  let pool: mysql.Pool;
  let app: express.Application;
  let router: Router;

  beforeAll(async () => {
    container = await new MySqlContainer("mysql:8").start();
    pool = mysql.createPool({
      host: container.getHost(),
      port: container.getPort(),
      user: container.getUsername(),
      password: container.getUserPassword(),
      database: container.getDatabase(),
    });

    // Load and execute schema
    const schema = fs.readFileSync(schemaPath, "utf-8");
    await pool.query(schema);

    // Load and execute seed data
    const seed = fs.readFileSync(seedPath, "utf-8");
    await pool.query(seed);

    // Create router
    router = await createRouter({
      spec: specPath,
      adapters: {
        mysql: new MysqlAdapter(pool),
      },
      auth: async () => ({ tenantId: "tenant-1" }),
    });

    // Create Express app with middleware adapter
    app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
      try {
        const response = await router.handle(req);
        if (!response) return next();
        res.status(response.status).json(response.body);
      } catch (err) {
        if (err instanceof OpenApiDbError) {
          res.status(err.status).json({ error: err.message, correlationId: "test" });
        } else {
          next(err);
        }
      }
    });
  }, 120000); // MySQL container can take longer to start

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
      expect(response.body.error).toBe("Resource not found");
    });

    it("returns 404 for user in different tenant", async () => {
      await request(app)
        .get("/users/44444444-4444-4444-4444-444444444444")
        .expect(404);
    });
  });

  describe("GET /users/count", () => {
    it("returns scalar count value", async () => {
      const response = await request(app).get("/users/count").expect(200);

      expect(typeof response.body).toBe("number");
      expect(response.body).toBeGreaterThanOrEqual(2);
    });
  });

  describe("DELETE /users/:id", () => {
    it("deletes user successfully", async () => {
      // Insert a user to delete
      await pool.query(
        "INSERT INTO users (id, first_name, last_name, tenant_id, status) VALUES (?, ?, ?, ?, ?)",
        ["99999999-9999-9999-9999-999999999999", "ToDelete", "User", "tenant-1", "active"]
      );

      // Delete the user
      await request(app)
        .delete("/users/99999999-9999-9999-9999-999999999999")
        .expect(200);

      // Verify user is gone
      await request(app)
        .get("/users/99999999-9999-9999-9999-999999999999")
        .expect(404);
    });
  });
});
