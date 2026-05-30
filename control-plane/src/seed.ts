import type { Sql } from "postgres";
import type { ClearinghouseConfig } from "./config.js";
import type { ClearinghouseActor } from "./auth.js";
import { hashSecret } from "./crypto.js";
import { getAppByPublicClientId, registerApp } from "./apps.js";

/**
 * Register realm-imported app_demo / m2m_demo in Postgres only (Keycloak clients already exist).
 * Required for Dashboard POST /api/signer/device/exchange, which authenticates the M2M client
 * against clearinghouse_apps — not Keycloak alone.
 */
export async function seedDemoAppIfMissing(sql: Sql): Promise<void> {
  if (process.env.CLEARINGHOUSE_SEED_DEMO_APP === "false") return;

  const publicClientId =
    process.env.CLEARINGHOUSE_DEMO_PUBLIC_CLIENT_ID?.trim() || "app_demo";
  const m2mClientId =
    process.env.CLEARINGHOUSE_DEMO_M2M_CLIENT_ID?.trim() || "m2m_demo";
  const m2mSecret =
    process.env.CLEARINGHOUSE_DEMO_M2M_CLIENT_SECRET?.trim() || "m2m-demo-dev-secret";
  const initiateLoginUri =
    process.env.DASHBOARD_DEVICE_INITIATE_LOGIN_URI?.trim() ||
    "http://localhost:3001/login/device";

  const existing = await getAppByPublicClientId(sql, publicClientId);
  if (existing) return;

  await sql`
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
      ${publicClientId},
      ${"Demo Public Signer App"},
      ${publicClientId},
      ${m2mClientId},
      ${hashSecret(m2mSecret)},
      ${"sign:job openid profile email"},
      ${"http://localhost:8080/* http://localhost:3001/* http://clearinghouse.localhost:8080/*"},
      'active',
      ${"demo"},
      true,
      ${initiateLoginUri}
    )
  `;

  console.info(
    "[clearinghouse] seeded demo app in DB",
    publicClientId,
    m2mClientId,
    "(Keycloak clients must already exist from realm import)",
  );
}

export async function seedDashboardAppIfConfigured(
  sql: Sql,
  config: ClearinghouseConfig,
  adminActor: ClearinghouseActor,
): Promise<void> {
  if (!config.seedDashboardApp) return;

  const existing = await getAppByPublicClientId(
    sql,
    process.env.CLEARINGHOUSE_DASHBOARD_PUBLIC_CLIENT_ID?.trim() || "app_dashboard",
  );
  if (existing) return;

  const keycloakOptions = {
    baseUrl: config.keycloakAdminUrl,
    realm: config.keycloakRealm,
    adminUser: config.keycloakAdminUser,
    adminPassword: config.keycloakAdminPassword,
  };

  try {
    const result = await registerApp(
      sql,
      adminActor,
      {
        name: config.dashboardAppName,
        allowedScopes: "sign:job openid profile email",
        allowedOrigins: ["http://localhost:8080/*", "http://localhost:3000/*"],
        ownerLabel: "livepeer-dashboard",
      },
      keycloakOptions,
    );

    console.info(
      "[clearinghouse] seeded dashboard app",
      result.app.public_client_id,
      result.app.m2m_client_id,
    );
    console.info("[clearinghouse] dashboard M2M secret (store securely):", result.m2mClientSecret);
  } catch (error) {
    console.warn("[clearinghouse] dashboard app seed failed (control plane still starts)", error);
  }
}
