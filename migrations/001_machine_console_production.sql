-- Production Machine Console schema. The executable copy lives in
-- src/server/production/schema.ts so compiled deployments can migrate without
-- relying on a source-tree file.
-- Run: node dist/server/production/migrate.js

CREATE TABLE IF NOT EXISTS mc_users (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS mc_wallets (address TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, verified_at TIMESTAMPTZ NOT NULL, UNIQUE (user_id, address));
CREATE TABLE IF NOT EXISTS mc_auth_challenges (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, message TEXT NOT NULL, nonce_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS mc_auth_challenges_lookup ON mc_auth_challenges(wallet_address, expires_at);
CREATE INDEX IF NOT EXISTS mc_auth_challenges_expiry ON mc_auth_challenges(expires_at);
CREATE INDEX IF NOT EXISTS mc_auth_challenges_consumed ON mc_auth_challenges(consumed_at) WHERE consumed_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS mc_auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, wallet_address TEXT NOT NULL REFERENCES mc_wallets(address) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, CONSTRAINT mc_auth_sessions_verified_wallet_fk FOREIGN KEY (user_id, wallet_address) REFERENCES mc_wallets(user_id, address) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS mc_auth_sessions_active ON mc_auth_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mc_auth_sessions_expiry ON mc_auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS mc_auth_sessions_revoked ON mc_auth_sessions(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS mc_machines (machine_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, label TEXT NOT NULL, role TEXT NOT NULL, wallet_address TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS mc_machines_owner ON mc_machines(owner_user_id, machine_id);
CREATE UNIQUE INDEX IF NOT EXISTS mc_machines_identity_owner_unique ON mc_machines(machine_id, owner_user_id);
CREATE TABLE IF NOT EXISTS mc_machine_capabilities (machine_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, capability TEXT NOT NULL CHECK (capability IN ('inspection','delivery','pick_place','mapping','inference','sensing','compute','charging','audit_capture')), created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (machine_id, capability), FOREIGN KEY (machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS mc_machine_capabilities_owner ON mc_machine_capabilities(owner_user_id, capability);
CREATE TABLE IF NOT EXISTS mc_runtime_sessions (session_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, machine_id TEXT NOT NULL, chain TEXT NOT NULL CHECK (chain='solana'), wallet_address TEXT NOT NULL, operator_id TEXT NOT NULL, policy_profile_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('fixture','live-read')), nonce_hash TEXT NOT NULL, metadata JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, FOREIGN KEY (machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS mc_runtime_sessions_machine_time ON mc_runtime_sessions(machine_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mc_runtime_sessions_active_machine ON mc_runtime_sessions(machine_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS mc_work_orders (work_order_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, machine_id TEXT, stage TEXT NOT NULL CHECK (stage IN ('queued','assigned','preparing','working','proof_submitted','settled','failed','cancelled')), required_capabilities JSONB NOT NULL, telemetry_required BOOLEAN NOT NULL, proof_required BOOLEAN NOT NULL, expected_outputs JSONB NOT NULL, settlement_chain TEXT NOT NULL CHECK (settlement_chain='solana'), settlement_amount NUMERIC NOT NULL CHECK (settlement_amount>0), settlement_asset TEXT NOT NULL, settlement_recipient TEXT NOT NULL, telemetry_ref TEXT, proof_id TEXT, settlement_intent_id TEXT, result_ref TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, FOREIGN KEY (machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE RESTRICT);
CREATE INDEX IF NOT EXISTS mc_work_orders_owner_stage ON mc_work_orders(owner_user_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS mc_work_orders_machine ON mc_work_orders(machine_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS mc_machine_credentials (id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES mc_machines(machine_id) ON DELETE CASCADE, secret_hash TEXT NOT NULL, label TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS mc_machine_credentials_active ON mc_machine_credentials(machine_id, id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS mc_telemetry_events (id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES mc_machines(machine_id) ON DELETE CASCADE, observed_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL, snapshot JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS mc_telemetry_machine_time ON mc_telemetry_events(machine_id, received_at DESC);
CREATE INDEX IF NOT EXISTS mc_telemetry_retention ON mc_telemetry_events(received_at);
CREATE TABLE IF NOT EXISTS mc_provider_capabilities (id TEXT PRIMARY KEY, provider_machine_id TEXT NOT NULL REFERENCES mc_machines(machine_id) ON DELETE CASCADE, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, resource_type TEXT NOT NULL CHECK (resource_type IN ('weather-data','soil-sensor-data','route-map','charging-slot','compute-burst','bandwidth-grant','telemetry-feed')), label TEXT NOT NULL, unit TEXT NOT NULL, rail_tags JSONB NOT NULL, availability TEXT NOT NULL CHECK (availability IN ('available','limited','unavailable')), price_amount NUMERIC, price_asset TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE (provider_machine_id, resource_type, label));
CREATE INDEX IF NOT EXISTS mc_provider_capabilities_discovery ON mc_provider_capabilities(resource_type, availability);
CREATE UNIQUE INDEX IF NOT EXISTS mc_provider_capabilities_identity_machine_unique ON mc_provider_capabilities(id, provider_machine_id);
CREATE TABLE IF NOT EXISTS mc_resource_requests (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, requester_machine_id TEXT NOT NULL REFERENCES mc_machines(machine_id) ON DELETE CASCADE, capability_id TEXT REFERENCES mc_provider_capabilities(id), provider_machine_id TEXT REFERENCES mc_machines(machine_id), resource_type TEXT NOT NULL, quantity NUMERIC NOT NULL CHECK (quantity > 0), max_price NUMERIC NOT NULL CHECK (max_price > 0), preferred_rails JSONB NOT NULL, purpose TEXT NOT NULL, quote_amount NUMERIC, quote_asset TEXT, state TEXT NOT NULL CHECK (state IN ('pending','quoted','accepted','granted','fulfilled','rejected','cancelled')), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS mc_resource_requests_owner ON mc_resource_requests(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mc_resource_requests_provider ON mc_resource_requests(provider_machine_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS mc_resource_requests_identity_owner_unique ON mc_resource_requests(id, owner_user_id);
CREATE TABLE IF NOT EXISTS mc_resource_quotes (
  id TEXT PRIMARY KEY,
  resource_request_id TEXT NOT NULL REFERENCES mc_resource_requests(id) ON DELETE CASCADE,
  provider_owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE,
  provider_machine_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  asset TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('offered','accepted','declined','withdrawn','expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, resource_request_id),
  FOREIGN KEY (provider_machine_id, provider_owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (capability_id, provider_machine_id) REFERENCES mc_provider_capabilities(id, provider_machine_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS mc_resource_quotes_active_provider ON mc_resource_quotes(resource_request_id, provider_machine_id) WHERE state IN ('offered','accepted');
CREATE UNIQUE INDEX IF NOT EXISTS mc_resource_quotes_one_accepted ON mc_resource_quotes(resource_request_id) WHERE state='accepted';
CREATE INDEX IF NOT EXISTS mc_resource_quotes_provider ON mc_resource_quotes(provider_owner_user_id, state, created_at DESC);
CREATE TABLE IF NOT EXISTS mc_access_grants (
  id TEXT PRIMARY KEY,
  resource_request_id TEXT NOT NULL REFERENCES mc_resource_requests(id) ON DELETE CASCADE,
  resource_quote_id TEXT NOT NULL,
  provider_owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE,
  provider_machine_id TEXT NOT NULL,
  requester_owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE,
  requester_machine_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','active','revoked','expired')),
  access_reference TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, resource_request_id),
  FOREIGN KEY (resource_quote_id, resource_request_id) REFERENCES mc_resource_quotes(id, resource_request_id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_machine_id, provider_owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (requester_machine_id, requester_owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS mc_access_grants_parties ON mc_access_grants(requester_owner_user_id, provider_owner_user_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS mc_access_grants_one_live_request ON mc_access_grants(resource_request_id) WHERE state IN ('pending','active');
CREATE TABLE IF NOT EXISTS mc_settlements (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE CASCADE, machine_id TEXT NOT NULL REFERENCES mc_machines(machine_id) ON DELETE RESTRICT, source_wallet TEXT NOT NULL, recipient_wallet TEXT NOT NULL, amount_lamports NUMERIC(30,0) NOT NULL CHECK (amount_lamports > 0), state TEXT NOT NULL CHECK (state IN ('created','awaiting_signature','submitting','submitted','confirmed','failed','cancelled')), unsigned_transaction TEXT, transaction_signature TEXT, last_valid_block_height NUMERIC(30,0), error_code TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS mc_settlements_owner ON mc_settlements(owner_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mc_settlements_transaction_signature_unique ON mc_settlements(transaction_signature) WHERE transaction_signature IS NOT NULL;
ALTER TABLE mc_settlements ADD COLUMN IF NOT EXISTS resource_request_id TEXT;
ALTER TABLE mc_settlements ADD COLUMN IF NOT EXISTS resource_quote_id TEXT;
ALTER TABLE mc_access_grants DROP CONSTRAINT IF EXISTS mc_access_grants_resource_request_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS mc_access_grants_one_live_request ON mc_access_grants(resource_request_id) WHERE state IN ('pending','active');
CREATE UNIQUE INDEX IF NOT EXISTS mc_settlements_one_per_request ON mc_settlements(resource_request_id) WHERE resource_request_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE mc_auth_sessions ADD CONSTRAINT mc_auth_sessions_verified_wallet_fk
    FOREIGN KEY (user_id, wallet_address) REFERENCES mc_wallets(user_id, address) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS mc_resource_receipts (
  id TEXT PRIMARY KEY,
  resource_request_id TEXT NOT NULL REFERENCES mc_resource_requests(id) ON DELETE RESTRICT,
  access_grant_id TEXT NOT NULL,
  settlement_id TEXT REFERENCES mc_settlements(id) ON DELETE RESTRICT,
  provider_owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE RESTRICT,
  requester_owner_user_id TEXT NOT NULL REFERENCES mc_users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('recorded','verified','rejected')),
  evidence_reference TEXT,
  result_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (access_grant_id, resource_request_id) REFERENCES mc_access_grants(id, resource_request_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS mc_resource_receipts_parties ON mc_resource_receipts(requester_owner_user_id, provider_owner_user_id, state);
ALTER TABLE mc_resource_receipts DROP CONSTRAINT IF EXISTS mc_resource_receipts_resource_request_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS mc_resource_receipts_one_live_request ON mc_resource_receipts(resource_request_id) WHERE state IN ('recorded','verified');
DO $$ BEGIN
  ALTER TABLE mc_resource_requests ADD CONSTRAINT mc_resource_requests_machine_owner_fk FOREIGN KEY (requester_machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_provider_capabilities ADD CONSTRAINT mc_provider_capabilities_machine_owner_fk FOREIGN KEY (provider_machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_resource_requests ADD CONSTRAINT mc_resource_requests_capability_provider_fk FOREIGN KEY (capability_id, provider_machine_id) REFERENCES mc_provider_capabilities(id, provider_machine_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_settlements ADD CONSTRAINT mc_settlements_request_fk FOREIGN KEY (resource_request_id) REFERENCES mc_resource_requests(id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_settlements ADD CONSTRAINT mc_settlements_quote_request_fk FOREIGN KEY (resource_quote_id, resource_request_id) REFERENCES mc_resource_quotes(id, resource_request_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_settlements ADD CONSTRAINT mc_settlements_request_required CHECK (resource_request_id IS NOT NULL AND resource_quote_id IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_machines ADD CONSTRAINT mc_machines_role_check
    CHECK (role IN ('robot_arm','drone','sensor','rover','warehouse_bot','edge_node')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_machines ADD CONSTRAINT mc_machines_verified_wallet_fk
    FOREIGN KEY (owner_user_id, wallet_address) REFERENCES mc_wallets(user_id, address) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_provider_capabilities ADD CONSTRAINT mc_provider_capabilities_resource_type_check
    CHECK (resource_type IN ('weather-data','soil-sensor-data','route-map','charging-slot','compute-burst','bandwidth-grant','telemetry-feed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_provider_capabilities ADD CONSTRAINT mc_provider_capabilities_price_check
    CHECK ((price_amount IS NULL AND price_asset IS NULL) OR (price_amount > 0 AND price_asset='SOL')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_resource_requests ADD CONSTRAINT mc_resource_requests_resource_type_check
    CHECK (resource_type IN ('weather-data','soil-sensor-data','route-map','charging-slot','compute-burst','bandwidth-grant','telemetry-feed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_resource_requests ADD CONSTRAINT mc_resource_requests_quote_check
    CHECK ((quote_amount IS NULL AND quote_asset IS NULL) OR (quote_amount > 0 AND quote_asset='SOL')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_resource_requests ADD CONSTRAINT mc_resource_requests_selected_state_check
    CHECK (state NOT IN ('accepted','granted','fulfilled') OR
      (capability_id IS NOT NULL AND provider_machine_id IS NOT NULL AND quote_amount IS NOT NULL AND quote_asset IS NOT NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_resource_quotes ADD CONSTRAINT mc_resource_quotes_asset_check CHECK (asset='SOL') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_settlements ADD CONSTRAINT mc_settlements_verified_wallet_fk
    FOREIGN KEY (owner_user_id, source_wallet) REFERENCES mc_wallets(user_id, address) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE mc_settlements ADD CONSTRAINT mc_settlements_machine_owner_fk
    FOREIGN KEY (machine_id, owner_user_id) REFERENCES mc_machines(machine_id, owner_user_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS mc_settlements_identity_request_unique ON mc_settlements(id, resource_request_id);
DO $$ BEGIN
  ALTER TABLE mc_resource_receipts ADD CONSTRAINT mc_resource_receipts_settlement_request_fk
    FOREIGN KEY (settlement_id, resource_request_id) REFERENCES mc_settlements(id, resource_request_id) ON DELETE RESTRICT NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
