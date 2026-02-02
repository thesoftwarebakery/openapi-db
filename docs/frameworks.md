# Framework Integration

openapi-db is framework-agnostic. It works with any Node.js HTTP framework by accepting a standard `IncomingMessage` request and returning a response object.

## How It Works

```typescript
const response = await router.handle(req);
// Returns: { status: number, headers?: Record<string, string>, body: unknown }
// Or: null (no matching route)
```

Your framework middleware:
1. Calls `router.handle(req)` with the incoming request
2. If `null`, passes to the next handler (route not found in openapi-db)
3. If response, sends it using your framework's response methods
4. Catches `OpenApiDbError` for error handling

## Express

```typescript
import express from "express";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
  auth: async (req) => {
    // Access Express-parsed data if needed
    const token = req.headers.authorization?.split(" ")[1];
    return token ? await verifyToken(token) : null;
  },
});

// Parse JSON bodies before openapi-db middleware
app.use(express.json());

// openapi-db middleware
app.use(async (req, res, next) => {
  try {
    const response = await router.handle(req);

    if (!response) {
      // No matching x-db route, continue to other handlers
      return next();
    }

    res.status(response.status).json(response.body);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.status(err.status).json({
        error: err.code,
        message: err.message,
      });
    } else {
      next(err);
    }
  }
});

// Your other routes still work
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(3000);
```

### With Express Auth Middleware

```typescript
import express from "express";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";

const app = express();
app.use(express.json());

// Your auth middleware sets req.user
app.use(async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    req.user = await verifyToken(token);
  }
  next();
});

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: { postgres: new PgAdapter(pool) },
  auth: async (req) => {
    // Access the user set by your auth middleware
    const expressReq = req as express.Request;
    return expressReq.user ?? null;
  },
});

app.use(async (req, res, next) => {
  try {
    const response = await router.handle(req);
    if (!response) return next();
    res.status(response.status).json(response.body);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.status(err.status).json({ error: err.code, message: err.message });
    } else {
      next(err);
    }
  }
});

app.listen(3000);
```

## Fastify

```typescript
import Fastify from "fastify";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const fastify = Fastify({ logger: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
  auth: async (req) => {
    // Fastify decorates req.raw with the raw IncomingMessage
    const token = req.headers.authorization?.split(" ")[1];
    return token ? await verifyToken(token) : null;
  },
});

// Use preHandler hook to intercept requests
fastify.addHook("preHandler", async (request, reply) => {
  try {
    // Pass the raw Node.js request
    const response = await router.handle(request.raw);

    if (response) {
      // Send response and prevent further processing
      reply.status(response.status).send(response.body);
    }
    // If null, continue to Fastify route handlers
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      reply.status(err.status).send({
        error: err.code,
        message: err.message,
      });
    } else {
      throw err;
    }
  }
});

// Your other routes
fastify.get("/health", async () => {
  return { ok: true };
});

fastify.listen({ port: 3000 });
```

### Accessing Fastify Request Body

If your routes need request body data and Fastify has already parsed it:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: { postgres: new PgAdapter(pool) },
});

fastify.addHook("preHandler", async (request, reply) => {
  try {
    // Attach parsed body to raw request for openapi-db to use
    (request.raw as any).body = request.body;

    const response = await router.handle(request.raw);
    if (response) {
      reply.status(response.status).send(response.body);
    }
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      reply.status(err.status).send({ error: err.code, message: err.message });
    } else {
      throw err;
    }
  }
});
```

## Hono

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const app = new Hono();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
  auth: async (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    return token ? await verifyToken(token) : null;
  },
});

// Middleware for all routes
app.use("*", async (c, next) => {
  try {
    // Get the raw Node.js request from Hono's context
    // Note: This requires @hono/node-server
    const nodeReq = c.env?.incoming;

    if (!nodeReq) {
      // Fallback: construct minimal request object
      return next();
    }

    const response = await router.handle(nodeReq);

    if (!response) {
      return next();
    }

    return c.json(response.body, response.status);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      return c.json(
        { error: err.code, message: err.message },
        err.status
      );
    }
    throw err;
  }
});

// Your other routes
app.get("/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: 3000 });
```

### Alternative: Hono with Request Adapter

If you can't access the raw Node.js request, create an adapter:

```typescript
import { Hono } from "hono";
import type { IncomingMessage } from "node:http";

// Minimal adapter to make Hono request look like IncomingMessage
function honoToNodeRequest(c: Context): Partial<IncomingMessage> {
  return {
    method: c.req.method,
    url: c.req.path + (c.req.query ? "?" + new URLSearchParams(c.req.query).toString() : ""),
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    // Pre-parse body for openapi-db
    body: await c.req.json().catch(() => undefined),
  } as any;
}

app.use("*", async (c, next) => {
  const req = honoToNodeRequest(c);
  const response = await router.handle(req as IncomingMessage);
  // ...
});
```

## Koa

```typescript
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const app = new Koa();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
  auth: async (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    return token ? await verifyToken(token) : null;
  },
});

// Parse body first
app.use(bodyParser());

// openapi-db middleware
app.use(async (ctx, next) => {
  try {
    // Attach parsed body to raw request
    (ctx.req as any).body = ctx.request.body;

    const response = await router.handle(ctx.req);

    if (!response) {
      return next();
    }

    ctx.status = response.status;
    ctx.body = response.body;
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      ctx.status = err.status;
      ctx.body = {
        error: err.code,
        message: err.message,
      };
    } else {
      throw err;
    }
  }
});

// Your other routes
app.use(async (ctx, next) => {
  if (ctx.path === "/health" && ctx.method === "GET") {
    ctx.body = { ok: true };
    return;
  }
  await next();
});

// 404 handler
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: "Not found" };
});

app.listen(3000);
```

## Raw Node.js

```typescript
import http from "node:http";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
  auth: async (req) => {
    const token = req.headers.authorization?.split(" ")[1];
    return token ? await verifyToken(token) : null;
  },
});

const server = http.createServer(async (req, res) => {
  try {
    const response = await router.handle(req);

    if (!response) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    res.writeHead(response.status, {
      "Content-Type": "application/json",
      ...response.headers,
    });
    res.end(JSON.stringify(response.body));
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.writeHead(err.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: err.code,
        message: err.message,
      }));
    } else {
      console.error(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

server.listen(3000);
```

## Common Patterns

### Correlation IDs

Add correlation IDs to error responses:

```typescript
app.use(async (req, res, next) => {
  const correlationId = req.headers["x-correlation-id"] || crypto.randomUUID();

  try {
    const response = await router.handle(req);
    if (!response) return next();

    res.setHeader("x-correlation-id", correlationId);
    res.status(response.status).json(response.body);
  } catch (err) {
    if (err instanceof OpenApiDbError) {
      res.status(err.status).json({
        error: err.code,
        message: err.message,
        correlationId,
      });
    } else {
      next(err);
    }
  }
});
```

### Request Logging

```typescript
app.use(async (req, res, next) => {
  const start = Date.now();

  try {
    const response = await router.handle(req);
    if (!response) return next();

    console.log({
      method: req.method,
      path: req.url,
      status: response.status,
      duration: Date.now() - start,
    });

    res.status(response.status).json(response.body);
  } catch (err) {
    console.error({
      method: req.method,
      path: req.url,
      error: err instanceof OpenApiDbError ? err.code : "INTERNAL_ERROR",
      duration: Date.now() - start,
    });
    throw err;
  }
});
```

### Rate Limiting Context

Pass rate limit info through auth context:

```typescript
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: { postgres: new PgAdapter(pool) },
  auth: async (req) => {
    const user = await verifyToken(req.headers.authorization);
    const rateLimitInfo = await checkRateLimit(user?.id);

    return {
      userId: user?.id,
      tenantId: user?.tenantId,
      // Available as ${{ auth.rateLimit.remaining }} in queries
      rateLimit: rateLimitInfo,
    };
  },
});
```

## Tips

1. **Parse body before openapi-db** - Most frameworks parse JSON bodies. Attach the parsed body to `req.body` for openapi-db to use.

2. **Use raw request when possible** - Pass the raw `IncomingMessage` (available as `req.raw` in Fastify, `ctx.req` in Koa) for best compatibility.

3. **Handle null responses** - `router.handle()` returns `null` when no matching x-db route exists. Pass to your framework's next handler.

4. **Catch OpenApiDbError** - Handle these specifically to return proper HTTP status codes and error messages.

5. **Order matters** - Place openapi-db middleware after body parsing but before your catch-all 404 handler.
