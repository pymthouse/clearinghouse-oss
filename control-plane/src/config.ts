export interface ClearinghouseConfig {
  listenHost: string;
  listenPort: number;
  databaseUrl: string;
  issuerUrl: string;
  /** When set, OIDC discovery/JWKS/token HTTP uses this base instead of localhost:8080 (Docker). */
  oidcInternalBaseUrl: string | undefined;
  oidcProvider: "keycloak" | "generic";
  sendIdentityParams: boolean;
  audience: string;
  defaultScope: string;
  allowInsecureOidc: boolean;
  adminClientId: string;
  adminClientSecret: string;
  requirePositiveBalance: boolean;
  kafkaBrokers: string[];
  kafkaTopic: string;
  kafkaGroupId: string;
  keycloakAdminUrl: string;
  keycloakAdminUser: string;
  keycloakAdminPassword: string;
  keycloakRealm: string;
  seedDashboardApp: boolean;
  dashboardAppName: string;
  credentialEncryptionKey: string | undefined;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for clearinghouse control plane`);
  return value;
}

function readEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function readCsvEnv(name: string, fallback: string): string[] {
  return (process.env[name]?.trim() || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function readClearinghouseConfig(): ClearinghouseConfig {
  const oidcProvider =
    process.env.CLEARINGHOUSE_OIDC_PROVIDER?.trim() === "generic" ? "generic" : "keycloak";

  return {
    listenHost: readEnv("CLEARINGHOUSE_LISTEN_HOST", "0.0.0.0"),
    listenPort: Number.parseInt(readEnv("CLEARINGHOUSE_LISTEN_PORT", "8090"), 10),
    databaseUrl: readRequiredEnv("CLEARINGHOUSE_DATABASE_URL"),
    issuerUrl: readEnv(
      "CLEARINGHOUSE_OIDC_ISSUER_URL",
      "http://localhost:8080/realms/clearinghouse",
    ),
    oidcInternalBaseUrl: process.env.CLEARINGHOUSE_OIDC_INTERNAL_BASE_URL?.trim() || undefined,
    oidcProvider,
    sendIdentityParams:
      process.env.CLEARINGHOUSE_OIDC_SEND_IDENTITY_PARAMS === "true" ||
      oidcProvider === "generic",
    audience: readEnv("CLEARINGHOUSE_OIDC_AUDIENCE", "livepeer-remote-signer"),
    defaultScope: readEnv("CLEARINGHOUSE_DEFAULT_SCOPE", "sign:job"),
    allowInsecureOidc: process.env.CLEARINGHOUSE_ALLOW_INSECURE_OIDC === "true",
    adminClientId: readEnv("CLEARINGHOUSE_ADMIN_CLIENT_ID", "clearinghouse-admin"),
    adminClientSecret: readRequiredEnv("CLEARINGHOUSE_ADMIN_CLIENT_SECRET"),
    requirePositiveBalance: process.env.CLEARINGHOUSE_REQUIRE_POSITIVE_BALANCE !== "false",
    kafkaBrokers: readCsvEnv("CLEARINGHOUSE_KAFKA_BROKERS", "kafka:9092"),
    kafkaTopic: readEnv("CLEARINGHOUSE_KAFKA_TOPIC", "create_signed_ticket"),
    kafkaGroupId: readEnv("CLEARINGHOUSE_KAFKA_GROUP_ID", "clearinghouse-usage-worker"),
    keycloakAdminUrl: readEnv("CLEARINGHOUSE_KEYCLOAK_ADMIN_URL", "http://keycloak:8080"),
    keycloakAdminUser: readEnv("KEYCLOAK_ADMIN", "admin"),
    keycloakAdminPassword: readEnv("KEYCLOAK_ADMIN_PASSWORD", "admin"),
    keycloakRealm: readEnv("CLEARINGHOUSE_KEYCLOAK_REALM", "clearinghouse"),
    seedDashboardApp: process.env.CLEARINGHOUSE_SEED_DASHBOARD_APP === "true",
    dashboardAppName: readEnv("CLEARINGHOUSE_DASHBOARD_APP_NAME", "livepeer-dashboard"),
    credentialEncryptionKey:
      process.env.CLEARINGHOUSE_CREDENTIAL_ENCRYPTION_KEY?.trim() || undefined,
  };
}
