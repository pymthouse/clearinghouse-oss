import type { Sql } from "postgres";
import type { ClearinghouseActor } from "./auth.js";
import { generateClientId, generateSecret, hashSecret } from "./crypto.js";
import { recordAuditEvent } from "./audit.js";
import { createKeycloakAppClients } from "./keycloak-admin.js";

export interface ClearinghouseAppRow {
  id: string;
  name: string;
  public_client_id: string;
  m2m_client_id: string;
  allowed_scopes: string;
  allowed_origins: string | null;
  status: string;
  owner_label: string | null;
  device_third_party_initiate_login: boolean;
  initiate_login_uri: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RegisterAppInput {
  name: string;
  allowedScopes?: string;
  allowedOrigins?: string[];
  ownerLabel?: string;
  publicClientId?: string;
  m2mClientId?: string;
  deviceThirdPartyInitiateLogin?: boolean;
  initiateLoginUri?: string | null;
}

export interface RegisterAppResult {
  app: ClearinghouseAppRow;
  m2mClientSecret: string;
}

export async function registerApp(
  sql: Sql,
  actor: ClearinghouseActor,
  input: RegisterAppInput,
  keycloakOptions: Parameters<typeof createKeycloakAppClients>[0],
): Promise<RegisterAppResult> {
  const publicClientId = input.publicClientId ?? generateClientId("app");
  const appId = publicClientId;
  const m2mClientId = input.m2mClientId ?? generateClientId("m2m");
  const m2mSecret = generateSecret();
  const allowedScopes = input.allowedScopes?.trim() || "sign:job openid profile email";
  const allowedOrigins = input.allowedOrigins?.join(" ") ?? null;
  const deviceThirdParty = input.deviceThirdPartyInitiateLogin ?? Boolean(input.initiateLoginUri);
  const initiateLoginUri = input.initiateLoginUri?.trim() || null;

  await createKeycloakAppClients(keycloakOptions, {
    publicClientId,
    m2mClientId,
    m2mSecret,
    name: input.name,
    redirectUris: input.allowedOrigins ?? ["http://localhost:8080/*"],
    deviceThirdPartyInitiateLogin: deviceThirdParty,
    initiateLoginUri,
  });

  const [app] = await sql<ClearinghouseAppRow[]>`
    INSERT INTO clearinghouse_apps (
      id,
      name,
      public_client_id,
      m2m_client_id,
      m2m_secret_hash,
      allowed_scopes,
      allowed_origins,
      status,
      owner_label,
      device_third_party_initiate_login,
      initiate_login_uri
    )
    VALUES (
      ${appId},
      ${input.name},
      ${publicClientId},
      ${m2mClientId},
      ${hashSecret(m2mSecret)},
      ${allowedScopes},
      ${allowedOrigins},
      'active',
      ${input.ownerLabel ?? null},
      ${deviceThirdParty},
      ${initiateLoginUri}
    )
    RETURNING *
  `;

  await recordAuditEvent(sql, actor, "app.register", "app", app.id, {
    publicClientId,
    m2mClientId,
    name: input.name,
  });

  return { app, m2mClientSecret: m2mSecret };
}

export async function listApps(sql: Sql): Promise<ClearinghouseAppRow[]> {
  return sql<ClearinghouseAppRow[]>`
    SELECT id, name, public_client_id, m2m_client_id, allowed_scopes, allowed_origins,
           status, owner_label, device_third_party_initiate_login, initiate_login_uri,
           created_at, updated_at
    FROM clearinghouse_apps
    ORDER BY created_at DESC
  `;
}

export async function getAppById(
  sql: Sql,
  appId: string,
): Promise<ClearinghouseAppRow | null> {
  const [app] = await sql<ClearinghouseAppRow[]>`
    SELECT id, name, public_client_id, m2m_client_id, allowed_scopes, allowed_origins,
           status, owner_label, device_third_party_initiate_login, initiate_login_uri,
           created_at, updated_at
    FROM clearinghouse_apps
    WHERE id = ${appId}
  `;
  return app ?? null;
}

export async function getAppByPublicClientId(
  sql: Sql,
  publicClientId: string,
): Promise<ClearinghouseAppRow | null> {
  const [app] = await sql<ClearinghouseAppRow[]>`
    SELECT id, name, public_client_id, m2m_client_id, allowed_scopes, allowed_origins,
           status, owner_label, device_third_party_initiate_login, initiate_login_uri,
           created_at, updated_at
    FROM clearinghouse_apps
    WHERE public_client_id = ${publicClientId}
  `;
  return app ?? null;
}

export async function setAppStatus(
  sql: Sql,
  actor: ClearinghouseActor,
  publicClientId: string,
  status: "active" | "disabled",
): Promise<ClearinghouseAppRow | null> {
  const [app] = await sql<ClearinghouseAppRow[]>`
    UPDATE clearinghouse_apps
    SET status = ${status}, updated_at = now()
    WHERE public_client_id = ${publicClientId}
    RETURNING *
  `;
  if (app) {
    await recordAuditEvent(sql, actor, "app.set_status", "app", app.id, { status });
  }
  return app ?? null;
}

export async function rotateAppM2mSecret(
  sql: Sql,
  actor: ClearinghouseActor,
  publicClientId: string,
  keycloakOptions: Parameters<typeof createKeycloakAppClients>[0],
): Promise<{ app: ClearinghouseAppRow; m2mClientSecret: string } | null> {
  const app = await getAppByPublicClientId(sql, publicClientId);
  if (!app) return null;

  const m2mSecret = generateSecret();
  await createKeycloakAppClients(keycloakOptions, {
    publicClientId: app.public_client_id,
    m2mClientId: app.m2m_client_id,
    m2mSecret,
    name: app.name,
    redirectUris: app.allowed_origins?.split(" ").filter(Boolean) ?? ["http://localhost:8080/*"],
    deviceThirdPartyInitiateLogin: app.device_third_party_initiate_login,
    initiateLoginUri: app.initiate_login_uri,
  });

  const [updated] = await sql<ClearinghouseAppRow[]>`
    UPDATE clearinghouse_apps
    SET m2m_secret_hash = ${hashSecret(m2mSecret)}, updated_at = now()
    WHERE public_client_id = ${publicClientId}
    RETURNING *
  `;

  if (updated) {
    await recordAuditEvent(sql, actor, "app.rotate_m2m", "app", updated.id, {});
  }

  return updated ? { app: updated, m2mClientSecret: m2mSecret } : null;
}
