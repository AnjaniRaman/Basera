-- Basera API schema. Property data lives as one JSON document per PG (the same document the
-- app keeps on the device), so the billing engine in shared/ is the only place business rules live.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  lang TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_codes_phone ON otp_codes(phone, created_at);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS properties_owner ON properties(owner_id);

-- Who can sign in to which property as tenant or staff: rebuilt from the document after every command.
CREATE TABLE IF NOT EXISTS people_index (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (property_id, role, ref_id)
);
CREATE INDEX IF NOT EXISTS people_index_phone ON people_index(phone);
CREATE INDEX IF NOT EXISTS people_index_email ON people_index(email);

-- Audit trail of applied commands.
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  version INT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB,
  actor JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_property ON events(property_id, version);

-- Uploaded documents (ID proofs, agreements). Small PGs: a few MB per resident at most.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size INT NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_property ON files(property_id);
