/**
 * Minimal Keycloak Admin API client for per-app OIDC client provisioning.
 * Failures are logged but do not block local DB registration when Keycloak is unavailable in dev.
 */

export interface KeycloakAdminOptions {
  baseUrl: string;
  realm: string;
  adminUser: string;
  adminPassword: string;
}

export interface KeycloakAppClientInput {
  publicClientId: string;
  m2mClientId: string;
  m2mSecret: string;
  name: string;
  redirectUris: string[];
  initiateLoginUri?: string | null;
  deviceThirdPartyInitiateLogin?: boolean;
}

let adminTokenCache: { token: string; expiresAt: number } | null = null;

async function getAdminToken(options: KeycloakAdminOptions): Promise<string | null> {
  if (adminTokenCache && adminTokenCache.expiresAt > Date.now() + 30_000) {
    return adminTokenCache.token;
  }

  const tokenUrl = `${options.baseUrl}/realms/master/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: options.adminUser,
    password: options.adminPassword,
  });

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (error) {
    console.warn("[keycloak-admin] admin token request failed", error);
    return null;
  }

  if (!response.ok) {
    console.warn("[keycloak-admin] failed to obtain admin token", response.status);
    return null;
  }

  const json = (await response.json()) as { access_token: string; expires_in?: number };
  adminTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 60) * 1000,
  };
  return json.access_token;
}

async function upsertClient(
  options: KeycloakAdminOptions,
  token: string,
  clientRepresentation: Record<string, unknown>,
): Promise<void> {
  const clientsUrl = `${options.baseUrl}/admin/realms/${options.realm}/clients`;
  const clientId = String(clientRepresentation.clientId);

  const listResponse = await fetch(
    `${clientsUrl}?clientId=${encodeURIComponent(clientId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const existing = listResponse.ok ? ((await listResponse.json()) as { id: string }[]) : [];

  if (existing.length > 0) {
    const updateResponse = await fetch(`${clientsUrl}/${existing[0].id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...clientRepresentation, id: existing[0].id }),
    });
    if (!updateResponse.ok) {
      console.warn("[keycloak-admin] client update failed", clientId, updateResponse.status);
    }
    return;
  }

  const createResponse = await fetch(clientsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(clientRepresentation),
  });
  if (!createResponse.ok) {
    console.warn("[keycloak-admin] client create failed", clientId, createResponse.status);
    return;
  }

  if (clientRepresentation.publicClient === true) {
    const location = createResponse.headers.get("Location");
    const keycloakClientUuid = location?.split("/").pop();
    if (keycloakClientUuid) {
      await addPublicClientIdMapper(options, token, keycloakClientUuid, clientId);
    }
  }
}

async function addPublicClientIdMapper(
  options: KeycloakAdminOptions,
  token: string,
  keycloakClientUuid: string,
  publicClientId: string,
): Promise<void> {
  const mapperUrl = `${options.baseUrl}/admin/realms/${options.realm}/clients/${keycloakClientUuid}/protocol-mappers/models`;
  const response = await fetch(mapperUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "client_id",
      protocol: "openid-connect",
      protocolMapper: "oidc-hardcoded-claim-mapper",
      config: {
        "claim.name": "client_id",
        "claim.value": publicClientId,
        "jsonType.label": "String",
        "access.token.claim": "true",
        "id.token.claim": "true",
        "userinfo.token.claim": "true",
      },
    }),
  });
  if (!response.ok) {
    console.warn("[keycloak-admin] mapper create failed", publicClientId, response.status);
  }
}

export async function createKeycloakAppClients(
  options: KeycloakAdminOptions,
  input: KeycloakAppClientInput,
): Promise<void> {
  const token = await getAdminToken(options);
  if (!token) return;

  const signerClaimsScope = "signer-claims";

  const publicAttributes: Record<string, string> = {
    "oauth2.device.authorization.grant.enabled": "true",
    "pkce.code.challenge.method": "S256",
  };
  if (input.deviceThirdPartyInitiateLogin && input.initiateLoginUri?.trim()) {
    publicAttributes["initiate.login.uri"] = input.initiateLoginUri.trim();
  }

  await upsertClient(options, token, {
    clientId: input.publicClientId,
    name: `${input.name} (public)`,
    enabled: true,
    protocol: "openid-connect",
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: input.redirectUris,
    webOrigins: ["+"],
    attributes: publicAttributes,
    defaultClientScopes: ["profile", "email", signerClaimsScope],
    optionalClientScopes: ["sign:job"],
    authenticationFlowBindingOverrides:
      input.deviceThirdPartyInitiateLogin
        ? { browser: "device-third-party-browser" }
        : undefined,
  });

  await upsertClient(options, token, {
    clientId: input.m2mClientId,
    name: `${input.name} (m2m)`,
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    secret: input.m2mSecret,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    attributes: {
      "linked.public.client.id": input.publicClientId,
    },
    defaultClientScopes: [
      signerClaimsScope,
      "device:approve",
      "sign:job",
      "users:token",
      "users:write",
    ],
    optionalClientScopes: [],
  });
}

export interface KeycloakRealmUserInput {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  usageSubject: string;
  password: string;
}

export interface KeycloakRealmUserRef {
  id: string;
  username: string;
}

function usersUrl(options: KeycloakAdminOptions): string {
  return `${options.baseUrl}/admin/realms/${options.realm}/users`;
}

export async function findUserByUsername(
  options: KeycloakAdminOptions,
  username: string,
): Promise<KeycloakRealmUserRef | null> {
  const token = await getAdminToken(options);
  if (!token) {
    throw new Error("Keycloak admin token unavailable");
  }

  const response = await fetch(
    `${usersUrl(options)}?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Keycloak user lookup failed: ${response.status}`);
  }

  const rows = (await response.json()) as { id: string; username: string }[];
  const match = rows.find((row) => row.username === username);
  if (!match) return null;
  return { id: match.id, username: match.username };
}

export async function createRealmUser(
  options: KeycloakAdminOptions,
  input: KeycloakRealmUserInput,
): Promise<KeycloakRealmUserRef> {
  const token = await getAdminToken(options);
  if (!token) {
    throw new Error("Keycloak admin token unavailable");
  }

  const representation: Record<string, unknown> = {
    username: input.username,
    enabled: true,
    emailVerified: true,
    attributes: {
      usage_subject: [input.usageSubject],
    },
    credentials: [
      {
        type: "password",
        value: input.password,
        temporary: false,
      },
    ],
  };
  if (input.email) representation.email = input.email;
  if (input.firstName) representation.firstName = input.firstName;
  if (input.lastName) representation.lastName = input.lastName;

  const response = await fetch(usersUrl(options), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(representation),
  });

  if (response.status === 409) {
    const existing = await findUserByUsername(options, input.username);
    if (!existing) {
      throw new Error("Keycloak user exists but could not be resolved");
    }
    await setUserPassword(options, existing.id, input.password);
    return existing;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Keycloak user create failed: ${response.status} ${text}`);
  }

  const location = response.headers.get("Location");
  const id = location?.split("/").pop();
  if (!id) {
    const created = await findUserByUsername(options, input.username);
    if (!created) throw new Error("Keycloak user created but id unknown");
    return created;
  }
  return { id, username: input.username };
}

export async function setUserPassword(
  options: KeycloakAdminOptions,
  keycloakUserId: string,
  password: string,
): Promise<void> {
  const token = await getAdminToken(options);
  if (!token) {
    throw new Error("Keycloak admin token unavailable");
  }

  const response = await fetch(
    `${usersUrl(options)}/${encodeURIComponent(keycloakUserId)}/reset-password`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "password",
        value: password,
        temporary: false,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Keycloak password reset failed: ${response.status}`);
  }
}
