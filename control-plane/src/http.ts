import type { Sql } from "postgres";
import { ClearinghouseAuthError, authenticateRequest, requireAdmin, requireAppM2m } from "./auth.js";
import type { ClearinghouseConfig } from "./config.js";
import {
  createClearinghouseBalanceHandler,
  createClearinghouseSignerHandlers,
} from "./bootstrap.js";
import {
  listApps,
  registerApp,
  rotateAppM2mSecret,
  setAppStatus,
} from "./apps.js";
import { issueGrant } from "./grants.js";
import { AppUserError, upsertAppUser } from "./app-users.js";
import { mintUserAccessToken } from "./user-tokens.js";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ClearinghouseAuthError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof AppUserError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof Error && "code" in error) {
    const err = error as Error & { code?: string; status?: number };
    return json(
      { error: err.message, code: err.code ?? "error" },
      typeof err.status === "number" ? err.status : 400,
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return json({ error: message }, 500);
}

function keycloakOptions(config: ClearinghouseConfig) {
  return {
    baseUrl: config.keycloakAdminUrl,
    realm: config.keycloakRealm,
    adminUser: config.keycloakAdminUser,
    adminPassword: config.keycloakAdminPassword,
  };
}

export async function handleClearinghouseRequest(
  sql: Sql,
  config: ClearinghouseConfig,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/health" && request.method === "GET") {
      return json({ status: "ok" });
    }

    const balancePath =
      path === "/api/signer/balance" || path === "/api/clearinghouse/apps/me/balance";
    if (balancePath) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const balanceHandler = createClearinghouseBalanceHandler(sql, config);
      return balanceHandler(request);
    }

    const bootstrapPath =
      path === "/api/signer/bootstrap" || path === "/api/clearinghouse/apps/me/bootstrap";
    const devicePath =
      path === "/api/signer/device/exchange" ||
      path === "/api/clearinghouse/apps/me/device/exchange";
    const appMePath = path === "/api/clearinghouse/apps/me";

    const usersPath = path === "/api/clearinghouse/apps/me/users";
    const userTokenMatch = /^\/api\/clearinghouse\/apps\/me\/users\/([^/]+)\/token$/.exec(
      path,
    );

    if (bootstrapPath || devicePath || appMePath || usersPath || userTokenMatch) {
      const actor = await authenticateRequest(sql, config, request);
      requireAppM2m(actor);
      const kcOpts = keycloakOptions(config);

      if (usersPath && request.method === "POST") {
        const body = (await request.json()) as {
          externalUserId: string;
          email?: string;
          firstName?: string;
          lastName?: string;
        };
        const result = await upsertAppUser(sql, actor, body, kcOpts);
        return json({
          user: {
            id: result.user.id,
            externalUserId: result.user.external_user_id,
            keycloakUserId: result.user.keycloak_user_id,
            status: result.user.status,
          },
          created: result.created,
        });
      }

      if (userTokenMatch && request.method === "POST") {
        const externalUserId = decodeURIComponent(userTokenMatch[1]);
        const body = (await request.json().catch(() => ({}))) as { scope?: string };
        const token = await mintUserAccessToken(
          sql,
          config,
          actor,
          externalUserId,
          body.scope,
        );
        return json(token);
      }

      const handlers = createClearinghouseSignerHandlers(sql, config, actor);

      if (bootstrapPath) {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        return handlers.bootstrap(request);
      }
      if (devicePath) {
        if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
        return handlers.deviceExchange(request);
      }
      if (appMePath && request.method === "GET") {
        const apps = await listApps(sql);
        const mine = apps.find((row) => row.public_client_id === actor.publicClientId);
        if (!mine) return json({ error: "Application not found" }, 404);
        return json({
          id: mine.id,
          name: mine.name,
          publicClientId: mine.public_client_id,
          m2mClientId: mine.m2m_client_id,
          allowedScopes: mine.allowed_scopes,
          status: mine.status,
        });
      }
    }

    if (path.startsWith("/api/clearinghouse/admin/")) {
      const actor = await authenticateRequest(sql, config, request);
      requireAdmin(actor);

      if (path === "/api/clearinghouse/admin/apps" && request.method === "GET") {
        const apps = await listApps(sql);
        return json({
          apps: apps.map((app) => ({
            id: app.id,
            name: app.name,
            publicClientId: app.public_client_id,
            m2mClientId: app.m2m_client_id,
            allowedScopes: app.allowed_scopes,
            status: app.status,
            ownerLabel: app.owner_label,
            createdAt: app.created_at,
          })),
        });
      }

      if (path === "/api/clearinghouse/admin/apps" && request.method === "POST") {
        const body = (await request.json()) as {
          name: string;
          allowedScopes?: string;
          allowedOrigins?: string[];
          ownerLabel?: string;
        };
        const result = await registerApp(sql, actor, body, keycloakOptions(config));
        return json({
          app: {
            id: result.app.id,
            name: result.app.name,
            publicClientId: result.app.public_client_id,
            m2mClientId: result.app.m2m_client_id,
            allowedScopes: result.app.allowed_scopes,
            status: result.app.status,
          },
          m2mClientSecret: result.m2mClientSecret,
        });
      }

      if (path.endsWith("/disable") && request.method === "POST") {
        const publicClientId = path.split("/")[5];
        const app = await setAppStatus(sql, actor, publicClientId, "disabled");
        if (!app) return json({ error: "Application not found" }, 404);
        return json({ status: app.status });
      }

      if (path.endsWith("/enable") && request.method === "POST") {
        const publicClientId = path.split("/")[5];
        const app = await setAppStatus(sql, actor, publicClientId, "active");
        if (!app) return json({ error: "Application not found" }, 404);
        return json({ status: app.status });
      }

      if (path.endsWith("/rotate-m2m") && request.method === "POST") {
        const publicClientId = path.split("/")[5];
        const result = await rotateAppM2mSecret(sql, actor, publicClientId, keycloakOptions(config));
        if (!result) return json({ error: "Application not found" }, 404);
        return json({
          m2mClientId: result.app.m2m_client_id,
          m2mClientSecret: result.m2mClientSecret,
        });
      }

      if (path === "/api/clearinghouse/admin/grants" && request.method === "POST") {
        const body = (await request.json()) as {
          issuer?: string;
          clientId: string;
          usageSubject: string;
          usageSubjectType?: string;
          amountWei: string;
          reason?: string;
        };
        const grant = await issueGrant(sql, actor, {
          issuer: body.issuer ?? config.issuerUrl,
          clientId: body.clientId,
          usageSubject: body.usageSubject,
          usageSubjectType: body.usageSubjectType ?? "external_user_id",
          amountWei: body.amountWei,
          reason: body.reason,
        });
        return json({ grantId: grant.id });
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
