import { createServer } from "node:http";
import { readClearinghouseConfig } from "./config.js";
import { getClearinghouseSql } from "./db.js";
import { ensureClearinghouseSchema } from "./schema.js";
import { ensureAdminConfig } from "./auth.js";
import { handleClearinghouseRequest } from "./http.js";
import { seedDashboardAppIfConfigured, seedDemoAppIfMissing } from "./seed.js";

async function waitForKeycloak(config: ReturnType<typeof readClearinghouseConfig>): Promise<boolean> {
  const healthUrl = `${config.keycloakAdminUrl}/realms/master`;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return true;
    } catch {
      // Keycloak not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

async function main(): Promise<void> {
  const config = readClearinghouseConfig();
  const sql = getClearinghouseSql(config.databaseUrl);

  await ensureClearinghouseSchema(sql);
  await ensureAdminConfig(sql, config);

  // Plain HTTP by design: this service is only reachable on the compose network
  // marked `internal: true`; TLS terminates at the Apache DMZ (see .snyk).
  const server = createServer((req, res) => {
    const host = req.headers.host ?? `localhost:${config.listenPort}`;
    const url = `http://${host}${req.url ?? "/"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const part of value) headers.append(key, part);
      } else {
        headers.set(key, value);
      }
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, {
        method: req.method,
        headers,
        body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });

      try {
        const response = await handleClearinghouseRequest(sql, config, request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        // Pure JSON API: pin the content type and disable sniffing so reflected
        // request data can never be interpreted as HTML by a browser.
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("x-content-type-options", "nosniff");
        const responseBody = Buffer.from(await response.arrayBuffer());
        res.end(responseBody);
      } catch (error) {
        console.error("[clearinghouse] request failed", error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  server.listen(config.listenPort, config.listenHost, () => {
    console.info(
      `[clearinghouse] control plane listening on http://${config.listenHost}:${config.listenPort}`,
    );

    void (async () => {
      const ready = await waitForKeycloak(config);
      if (!ready) {
        console.warn("[clearinghouse] Keycloak not ready; app seed deferred");
        return;
      }
      await seedDemoAppIfMissing(sql);
      await seedDashboardAppIfConfigured(sql, config, {
        type: "admin",
        clientId: config.adminClientId,
      });
    })();
  });
}

main().catch((error) => {
  console.error("[clearinghouse] fatal", error);
  process.exit(1);
});
