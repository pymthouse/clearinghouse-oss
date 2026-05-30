import type { Sql } from "postgres";
import type { ClearinghouseConfig } from "./config.js";
import type { ClearinghouseActor } from "./auth.js";
import { AppUserError, getAppUser } from "./app-users.js";
import { getAppById } from "./apps.js";
import { decryptCredential } from "./credential-crypto.js";
import { createOidcFetch } from "./oidc-fetch.js";

export type MintUserAccessTokenResult = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

function parseScopes(allowedScopes: string): Set<string> {
  return new Set(allowedScopes.split(/\s+/).filter(Boolean));
}

function validateRequestedScopes(requested: string[], allowed: Set<string>): void {
  for (const scope of requested) {
    if (!allowed.has(scope)) {
      throw new AppUserError(
        `Scope not allowed for application: ${scope}`,
        403,
        "invalid_scope",
      );
    }
  }
}

export async function mintUserAccessToken(
  sql: Sql,
  config: ClearinghouseConfig,
  actor: ClearinghouseActor,
  externalUserId: string,
  scopeInput?: string,
): Promise<MintUserAccessTokenResult> {
  if (actor.type !== "app_m2m") {
    throw new AppUserError("app M2M authentication required", 403, "forbidden");
  }

  if (!config.credentialEncryptionKey) {
    throw new AppUserError(
      "CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY is not configured",
      500,
      "server_error",
    );
  }

  const app = await getAppById(sql, actor.appId);
  if (!app || app.status !== "active") {
    throw new AppUserError("Application is not registered or is disabled", 403, "app_disabled");
  }

  const appUser = await getAppUser(sql, actor.appId, externalUserId.trim());
  if (!appUser || appUser.status !== "active") {
    throw new AppUserError("App user not found; upsert before minting", 404, "not_found");
  }

  const [credentialRow] = await sql<[{ mint_credential_enc: string }]>`
    SELECT mint_credential_enc FROM clearinghouse_app_users WHERE id = ${appUser.id}
  `;
  if (!credentialRow) {
    throw new AppUserError("App user credential missing", 500, "server_error");
  }

  const defaultScope = "openid sign:job";
  const scope = (scopeInput?.trim() || defaultScope).trim();
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  validateRequestedScopes(requestedScopes, parseScopes(app.allowed_scopes));

  const password = decryptCredential(credentialRow.mint_credential_enc);
  const issuerBase =
    config.oidcInternalBaseUrl?.replace(/\/$/, "") ||
    config.issuerUrl.replace(/\/$/, "");
  const realmMatch = /\/realms\/([^/]+)$/.exec(config.issuerUrl.replace(/\/$/, ""));
  const realm = realmMatch?.[1] ?? config.keycloakRealm;
  const tokenUrl = `${issuerBase}/realms/${realm}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: actor.publicClientId,
    username: appUser.external_user_id,
    password,
    scope,
  });

  const oidcFetch = createOidcFetch(config.oidcInternalBaseUrl);
  const response = await (oidcFetch ?? fetch)(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new AppUserError(
      payload.error_description || payload.error || "token mint failed",
      502,
      "server_error",
    );
  }

  return {
    access_token: payload.access_token,
    expires_in: payload.expires_in ?? 300,
    token_type: payload.token_type ?? "Bearer",
    scope: payload.scope ?? scope,
  };
}
