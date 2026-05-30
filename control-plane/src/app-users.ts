import type { Sql } from "postgres";
import type { ClearinghouseActor } from "./auth.js";
import { encryptCredential } from "./credential-crypto.js";
import { generateClientId, generateSecret } from "./crypto.js";
import {
  createRealmUser,
  findUserByUsername,
  type KeycloakAdminOptions,
} from "./keycloak-admin.js";
import { getAppById } from "./apps.js";

const EXTERNAL_USER_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export class AppUserError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type UpsertAppUserInput = {
  externalUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type AppUserRow = {
  id: string;
  app_id: string;
  external_user_id: string;
  keycloak_user_id: string;
  status: string;
};

export function validateExternalUserId(externalUserId: string): string {
  const trimmed = externalUserId.trim();
  if (!trimmed || !EXTERNAL_USER_ID_RE.test(trimmed)) {
    throw new AppUserError(
      "externalUserId must be 1-64 characters (letters, digits, ., _, -)",
      400,
      "invalid_request",
    );
  }
  return trimmed;
}

export async function getAppUser(
  sql: Sql,
  appId: string,
  externalUserId: string,
): Promise<AppUserRow | null> {
  const [row] = await sql<AppUserRow[]>`
    SELECT id, app_id, external_user_id, keycloak_user_id, status
    FROM clearinghouse_app_users
    WHERE app_id = ${appId} AND external_user_id = ${externalUserId}
  `;
  return row ?? null;
}

export async function upsertAppUser(
  sql: Sql,
  actor: ClearinghouseActor,
  input: UpsertAppUserInput,
  keycloakOptions: KeycloakAdminOptions,
): Promise<{ user: AppUserRow; created: boolean }> {
  if (actor.type !== "app_m2m") {
    throw new AppUserError("app M2M authentication required", 403, "forbidden");
  }

  const externalUserId = validateExternalUserId(input.externalUserId);
  const app = await getAppById(sql, actor.appId);
  if (app?.status !== "active") {
    throw new AppUserError("Application is not registered or is disabled", 403, "app_disabled");
  }

  const existing = await getAppUser(sql, actor.appId, externalUserId);
  if (existing) {
    const kcUser = await findUserByUsername(keycloakOptions, externalUserId);
    if (!kcUser) {
      throw new AppUserError("Keycloak user missing for provisioned app user", 502, "server_error");
    }
    return { user: existing, created: false };
  }

  const mintPassword = generateSecret();
  const kcUser = await createRealmUser(keycloakOptions, {
    username: externalUserId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    usageSubject: externalUserId,
    password: mintPassword,
  });

  const rowId = `usr_${generateClientId("app").slice(4)}`;

  const [row] = await sql<AppUserRow[]>`
    INSERT INTO clearinghouse_app_users (
      id,
      app_id,
      external_user_id,
      keycloak_user_id,
      mint_credential_enc,
      status
    )
    VALUES (
      ${rowId},
      ${actor.appId},
      ${externalUserId},
      ${kcUser.id},
      ${encryptCredential(mintPassword)},
      'active'
    )
    RETURNING id, app_id, external_user_id, keycloak_user_id, status
  `;

  return { user: row, created: true };
}
