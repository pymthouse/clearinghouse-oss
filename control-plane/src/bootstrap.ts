import { PmtHouseError } from "@pymthouse/builder-sdk";
import {
  createJwtClaimsIdentityResolver,
  createOAuthSignerTokenIssuer,
  createSignerRouteHandlers,
} from "@pymthouse/builder-sdk/signer/server";
import type { Sql } from "postgres";
import type { ClearinghouseConfig } from "./config.js";
import type { ClearinghouseActor } from "./auth.js";
import { getAppByPublicClientId } from "./apps.js";
import { PostgresSignerAccountingStore } from "./accounting.js";
import { createOidcFetch } from "./oidc-fetch.js";

function createSignerCore(sql: Sql, config: ClearinghouseConfig) {
  const accountingStore = new PostgresSignerAccountingStore(sql);
  const oidcFetch = createOidcFetch(config.oidcInternalBaseUrl);
  const identityResolver = createJwtClaimsIdentityResolver({
    issuerUrl: config.issuerUrl,
    audience: config.audience,
    allowInsecureHttp: config.allowInsecureOidc,
    accessTokenProfile:
      config.oidcProvider === "keycloak" ? "oauth2-provider-jwt" : "rfc9068",
    defaultUsageSubjectType: "external_user_id",
    fetch: oidcFetch,
  });
  return { accountingStore, identityResolver, oidcFetch };
}

export function createClearinghouseBalanceHandler(
  sql: Sql,
  config: ClearinghouseConfig,
) {
  const { accountingStore, identityResolver } = createSignerCore(sql, config);
  return async (request: Request): Promise<Response> => {
    try {
      const header = request.headers.get("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match?.[1]?.trim()) {
        throw new PmtHouseError("Missing Bearer token", {
          status: 401,
          code: "invalid_token",
        });
      }
      const identity = await identityResolver.resolveFromBearerToken(match[1].trim());
      const balance = (await accountingStore.getBalance(identity)) ?? null;
      return Response.json({ balance });
    } catch (error) {
      if (error instanceof PmtHouseError) {
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      }
      const message = error instanceof Error ? error.message : "Unexpected error";
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

export function createClearinghouseSignerHandlers(
  sql: Sql,
  config: ClearinghouseConfig,
  actor: ClearinghouseActor,
) {
  if (actor.type !== "app_m2m") {
    throw new Error("createClearinghouseSignerHandlers requires an app_m2m actor");
  }

  const { accountingStore, identityResolver, oidcFetch } = createSignerCore(sql, config);

  const tokenIssuer = createOAuthSignerTokenIssuer({
    issuerUrl: config.issuerUrl,
    clientId: actor.clientId,
    clientSecret: actor.m2mClientSecret,
    audience: config.audience,
    scope: config.defaultScope,
    sendIdentityParams: config.sendIdentityParams,
    allowInsecureHttp: config.allowInsecureOidc,
    fetch: oidcFetch,
  });

  return createSignerRouteHandlers({
    defaultScope: config.defaultScope,
    identityResolver,
    accountingStore,
    tokenIssuer,
    beforeMint: async ({ identity, balance, input }) => {
      const app = await getAppByPublicClientId(sql, identity.clientId);
      if (!app || app.status !== "active") {
        throw new PmtHouseError("Application is not registered or is disabled", {
          status: 403,
          code: "app_disabled",
        });
      }

      if (actor.publicClientId !== identity.clientId) {
        throw new PmtHouseError("clientId does not match authenticated application", {
          status: 403,
          code: "identity_mismatch",
        });
      }

      if (input.clientId && input.clientId !== identity.clientId) {
        throw new PmtHouseError("clientId does not match subject token", {
          status: 403,
          code: "identity_mismatch",
        });
      }

      const scopes = app.allowed_scopes.split(/\s+/);
      const requested = (input.scope ?? config.defaultScope).split(/\s+/);
      for (const scope of requested) {
        if (scope && !scopes.includes(scope)) {
          throw new PmtHouseError(`Scope not allowed for application: ${scope}`, {
            status: 403,
            code: "invalid_scope",
          });
        }
      }

      if (config.requirePositiveBalance) {
        const remaining = balance?.remainingWei ?? "0";
        if (BigInt(remaining) <= BigInt(0)) {
          throw new PmtHouseError("Insufficient signer credit balance", {
            status: 402,
            code: "insufficient_balance",
          });
        }
      }
    },
  });
}
