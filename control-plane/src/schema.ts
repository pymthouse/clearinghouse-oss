import type { Sql } from "postgres";

export async function ensureClearinghouseSchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS clearinghouse_admin_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      admin_client_id TEXT NOT NULL,
      admin_secret_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clearinghouse_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_client_id TEXT NOT NULL UNIQUE,
      m2m_client_id TEXT NOT NULL UNIQUE,
      m2m_secret_hash TEXT NOT NULL,
      allowed_scopes TEXT NOT NULL DEFAULT 'sign:job',
      allowed_origins TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      owner_label TEXT,
      device_third_party_initiate_login BOOLEAN NOT NULL DEFAULT false,
      initiate_login_uri TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    ALTER TABLE clearinghouse_apps
    ADD COLUMN IF NOT EXISTS device_third_party_initiate_login BOOLEAN NOT NULL DEFAULT false
  `;
  await sql`
    ALTER TABLE clearinghouse_apps
    ADD COLUMN IF NOT EXISTS initiate_login_uri TEXT
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clearinghouse_audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS signer_credit_grants (
      id BIGSERIAL PRIMARY KEY,
      issuer TEXT NOT NULL,
      client_id TEXT NOT NULL,
      usage_subject TEXT NOT NULL,
      usage_subject_type TEXT NOT NULL,
      amount_wei NUMERIC(78, 0) NOT NULL,
      reason TEXT,
      issued_by_actor_type TEXT,
      issued_by_actor_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS signer_usage_events (
      id BIGSERIAL PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      issuer TEXT NOT NULL,
      client_id TEXT NOT NULL,
      usage_subject TEXT NOT NULL,
      usage_subject_type TEXT NOT NULL,
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      manifest_id TEXT,
      pipeline TEXT,
      computed_fee_wei TEXT,
      pixels BIGINT,
      sequence_number BIGINT,
      occurred_at TIMESTAMPTZ NOT NULL,
      raw JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_signer_usage_events_identity
      ON signer_usage_events (issuer, client_id, usage_subject, usage_subject_type)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_clearinghouse_apps_public_client
      ON clearinghouse_apps (public_client_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clearinghouse_app_users (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES clearinghouse_apps (id) ON DELETE CASCADE,
      external_user_id TEXT NOT NULL,
      keycloak_user_id TEXT NOT NULL,
      mint_credential_enc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (app_id, external_user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_clearinghouse_app_users_app_external
      ON clearinghouse_app_users (app_id, external_user_id)
  `;
}
