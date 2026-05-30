import type { Sql } from "postgres";
import type { ClearinghouseConfig } from "./config.js";
import { hashSecret, verifySecret } from "./crypto.js";

export type ClearinghouseActor =
  | { type: "admin"; clientId: string }
  | {
      type: "app_m2m";
      clientId: string;
      m2mClientSecret: string;
      publicClientId: string;
      appId: string;
    };

export class ClearinghouseAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 401, code = "unauthorized") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseBasicAuth(header: string | null): { clientId: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const encoded = header.slice("Basic ".length).trim();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    clientId: decoded.slice(0, separator),
    secret: decoded.slice(separator + 1),
  };
}

export async function ensureAdminConfig(
  sql: Sql,
  config: ClearinghouseConfig,
): Promise<void> {
  const adminHash = hashSecret(config.adminClientSecret);
  await sql`
    INSERT INTO clearinghouse_admin_config (id, admin_client_id, admin_secret_hash)
    VALUES ('default', ${config.adminClientId}, ${adminHash})
    ON CONFLICT (id) DO UPDATE SET
      admin_client_id = EXCLUDED.admin_client_id,
      admin_secret_hash = EXCLUDED.admin_secret_hash
  `;
}

export async function authenticateRequest(
  sql: Sql,
  config: ClearinghouseConfig,
  request: Request,
): Promise<ClearinghouseActor> {
  const basic = parseBasicAuth(request.headers.get("authorization"));
  if (!basic) {
    throw new ClearinghouseAuthError("Missing Basic authorization", 401, "invalid_token");
  }

  if (basic.clientId === config.adminClientId) {
    const [row] = await sql<[{ admin_secret_hash: string }]>`
      SELECT admin_secret_hash FROM clearinghouse_admin_config WHERE id = 'default'
    `;
    if (!row || !verifySecret(basic.secret, row.admin_secret_hash)) {
      throw new ClearinghouseAuthError("Invalid administrator credentials", 403, "invalid_token");
    }
    return { type: "admin", clientId: basic.clientId };
  }

  const [app] = await sql<
    [{ id: string; public_client_id: string; m2m_secret_hash: string; status: string }]
  >`
    SELECT id, public_client_id, m2m_secret_hash, status
    FROM clearinghouse_apps
    WHERE m2m_client_id = ${basic.clientId}
  `;

  if (!app) {
    throw new ClearinghouseAuthError("Unknown application client", 403, "invalid_client");
  }
  if (!verifySecret(basic.secret, app.m2m_secret_hash)) {
    throw new ClearinghouseAuthError("Invalid application credentials", 403, "invalid_token");
  }
  if (app.status !== "active") {
    throw new ClearinghouseAuthError("Application is disabled", 403, "app_disabled");
  }

  return {
    type: "app_m2m",
    clientId: basic.clientId,
    m2mClientSecret: basic.secret,
    publicClientId: app.public_client_id,
    appId: app.id,
  };
}

export function requireAdmin(actor: ClearinghouseActor): asserts actor is Extract<
  ClearinghouseActor,
  { type: "admin" }
> {
  if (actor.type !== "admin") {
    throw new ClearinghouseAuthError("Administrator access required", 403, "forbidden");
  }
}

export function requireAppM2m(actor: ClearinghouseActor): asserts actor is Extract<
  ClearinghouseActor,
  { type: "app_m2m" }
> {
  if (actor.type !== "app_m2m") {
    throw new ClearinghouseAuthError("Application M2M access required", 403, "forbidden");
  }
}
