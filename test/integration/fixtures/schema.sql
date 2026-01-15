CREATE TABLE users (
  id UUID PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT DEFAULT 'active'
);
