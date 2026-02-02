# Request & Response Validation

openapi-db focuses on routing and database query execution. It does not validate requests or responses against your OpenAPI schema. This is intentional - excellent validation libraries already exist, and integrating them gives you more control.

## Recommended Libraries

| Library | Framework | Description |
|---------|-----------|-------------|
| [express-openapi-validator](https://github.com/cdimascio/express-openapi-validator) | Express | Full request/response validation |
| [fastify-openapi](https://github.com/fastify/fastify-swagger) | Fastify | Schema validation via Fastify's built-in support |
| [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) | Hono | Zod-based validation with OpenAPI |
| [ajv](https://ajv.js.org/) | Any | JSON Schema validator (manual integration) |

## Express with express-openapi-validator

```bash
npm install express-openapi-validator
```

```typescript
import express from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Parse JSON bodies
app.use(express.json());

// Validate requests against OpenAPI spec
app.use(
  OpenApiValidator.middleware({
    apiSpec: "./openapi.yaml",
    validateRequests: true,
    validateResponses: false, // Optional: validate responses too
  })
);

// Create openapi-db router
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
});

// openapi-db middleware (after validation)
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

// Handle validation errors
app.use((err, req, res, next) => {
  if (err.status === 400 || err.status === 415) {
    // Validation error from express-openapi-validator
    res.status(err.status).json({
      error: "VALIDATION_ERROR",
      message: err.message,
      errors: err.errors,
    });
  } else {
    next(err);
  }
});

app.listen(3000);
```

### What Gets Validated

With `express-openapi-validator`, the following are validated before reaching openapi-db:

- **Path parameters** - Type, format, pattern
- **Query parameters** - Type, required, enum values
- **Request body** - Schema validation, required fields
- **Content-Type** - Must match spec

Invalid requests are rejected with a 400 error before the database query runs.

## Fastify with Built-in Validation

Fastify has built-in JSON Schema validation. You can use `@fastify/swagger` to load your OpenAPI spec:

```bash
npm install @fastify/swagger
```

```typescript
import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { createRouter, PgAdapter, OpenApiDbError } from "openapi-db";
import { Pool } from "pg";
import fs from "node:fs";
import yaml from "yaml";

const fastify = Fastify({ logger: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Load and register OpenAPI spec for validation
const spec = yaml.parse(fs.readFileSync("./openapi.yaml", "utf-8"));
await fastify.register(swagger, {
  mode: "static",
  specification: { document: spec },
});

// Create openapi-db router
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: {
    postgres: new PgAdapter(pool),
  },
});

// Register routes with validation schemas extracted from OpenAPI
// (You'll need to map OpenAPI paths to Fastify routes)
fastify.addHook("preHandler", async (request, reply) => {
  try {
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

fastify.listen({ port: 3000 });
```

## Manual Validation with Ajv

For frameworks without OpenAPI validation middleware, use Ajv directly:

```bash
npm install ajv ajv-formats
```

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import yaml from "yaml";
import fs from "node:fs";

// Load OpenAPI spec
const spec = yaml.parse(fs.readFileSync("./openapi.yaml", "utf-8"));

// Set up Ajv
const ajv = new Ajv({ allErrors: true, coerceTypes: true });
addFormats(ajv);

// Extract and compile schemas from OpenAPI spec
function getRequestBodySchema(path: string, method: string) {
  const operation = spec.paths[path]?.[method];
  return operation?.requestBody?.content?.["application/json"]?.schema;
}

// Validation middleware
function validateBody(path: string, method: string) {
  const schema = getRequestBodySchema(path, method);
  if (!schema) return (req, res, next) => next();

  const validate = ajv.compile(schema);

  return (req, res, next) => {
    if (!validate(req.body)) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Invalid request body",
        errors: validate.errors,
      });
    }
    next();
  };
}

// Usage
app.post("/users", validateBody("/users", "post"), async (req, res, next) => {
  const response = await router.handle(req);
  // ...
});
```

## Validation Error Responses

Here's a recommended error response format for validation errors:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "errors": [
    {
      "path": "/body/email",
      "message": "must match format \"email\""
    },
    {
      "path": "/body/firstName",
      "message": "must NOT have fewer than 1 characters"
    }
  ]
}
```

## Response Validation

Response validation is useful during development to catch mismatches between your API spec and actual responses:

```typescript
app.use(
  OpenApiValidator.middleware({
    apiSpec: "./openapi.yaml",
    validateRequests: true,
    validateResponses: process.env.NODE_ENV !== "production", // Dev only
  })
);
```

Note: Response validation adds overhead. Consider enabling it only in development/staging.

## Stripping x-db for Validation

Some validators may warn about the `x-db` extension. You can strip it:

```typescript
import yaml from "yaml";
import fs from "node:fs";

function loadSpecWithoutXDb(path: string) {
  const spec = yaml.parse(fs.readFileSync(path, "utf-8"));

  // Remove x-db from all operations
  for (const pathItem of Object.values(spec.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (pathItem[method]?.["x-db"]) {
        delete pathItem[method]["x-db"];
      }
    }
  }

  return spec;
}

// Use stripped spec for validation
app.use(
  OpenApiValidator.middleware({
    apiSpec: loadSpecWithoutXDb("./openapi.yaml"),
    validateRequests: true,
  })
);

// Use full spec for openapi-db
const router = await createRouter({
  spec: "./openapi.yaml",
  adapters: { postgres: new PgAdapter(pool) },
});
```

## Why openapi-db Doesn't Include Validation

1. **Existing solutions are mature** - Libraries like express-openapi-validator are well-tested and feature-complete
2. **Separation of concerns** - Validation is orthogonal to database query execution
3. **Flexibility** - You choose your validation strategy (strict, lenient, development-only)
4. **Performance** - You can skip validation in production if you trust your clients
5. **Framework-specific** - Each framework has its own best practices for validation
