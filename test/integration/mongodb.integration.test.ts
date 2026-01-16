import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient, type Db } from "mongodb";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, OpenApiDbError, MongoAdapter, type Router } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "mongodb");

const specPath = path.join(fixturesDir, "openapi.yaml");
const seedPath = path.join(fixturesDir, "seed.json");

describe("MongoAdapter integration", () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let app: express.Application;
  let router: Router;

  beforeAll(async () => {
    container = await new MongoDBContainer("mongo:7").start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    db = client.db("testdb");

    // Load and insert seed data
    const seedData = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    await db.collection("users").insertMany(seedData);

    // Create router
    router = await createRouter({
      spec: specPath,
      adapters: {
        mongo: new MongoAdapter(db),
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
  }, 60000);

  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  describe("GET /users", () => {
    it("returns users with field mapping applied", async () => {
      const response = await request(app).get("/users").expect(200);

      expect(response.body).toHaveLength(2); // Only active users from tenant-1
      expect(response.body[0]).toHaveProperty("firstName");
      expect(response.body[0]).toHaveProperty("lastName");
      expect(response.body[0]).toHaveProperty("id");
      expect(response.body[0]).not.toHaveProperty("first_name");
      expect(response.body[0]).not.toHaveProperty("_id");
    });

    it("filters by status query parameter", async () => {
      const response = await request(app).get("/users?status=inactive").expect(200);

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
      expect(response.body.id).toBe("11111111-1111-1111-1111-111111111111");
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

      // Verify user exists in database
      const dbUser = await db.collection("users").findOne({ _id: response.body.id });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.first_name).toBe("Eve");
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
    it("returns count object", async () => {
      const response = await request(app).get("/users/count").expect(200);

      expect(response.body).toHaveProperty("count");
      expect(typeof response.body.count).toBe("number");
      expect(response.body.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("PATCH /users/:id/status", () => {
    it("updates user status and returns updated document", async () => {
      const response = await request(app)
        .patch("/users/22222222-2222-2222-2222-222222222222/status")
        .send({ status: "suspended" })
        .expect(200);

      expect(response.body.firstName).toBe("Bob");
      expect(response.body.status).toBe("suspended");

      // Verify in database
      const dbUser = await db
        .collection("users")
        .findOne({ _id: "22222222-2222-2222-2222-222222222222" } as any);
      expect(dbUser?.status).toBe("suspended");

      // Reset for other tests
      await db
        .collection("users")
        .updateOne(
          { _id: "22222222-2222-2222-2222-222222222222" } as any,
          { $set: { status: "active" } }
        );
    });
  });

  describe("GET /users/stats", () => {
    it("returns aggregated stats by status", async () => {
      const response = await request(app).get("/users/stats").expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);

      // Should have stats for active and inactive statuses
      const activeStats = response.body.find((s: { status: string }) => s.status === "active");
      const inactiveStats = response.body.find(
        (s: { status: string }) => s.status === "inactive"
      );

      expect(activeStats).toBeDefined();
      expect(activeStats.count).toBeGreaterThanOrEqual(2);

      expect(inactiveStats).toBeDefined();
      expect(inactiveStats.count).toBe(1);
    });
  });
});
