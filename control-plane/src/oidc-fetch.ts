import type { FetchLike } from "@pymthouse/builder-sdk";

/**
 * Rewrite public DMZ hostnames in OIDC discovery/JWKS/token URLs to an internal base
 * reachable from inside Docker (e.g. http://keycloak:8080). Token `iss` stays the public
 * issuer; only HTTP fetches are routed internally.
 */
export function createOidcFetch(internalBaseUrl: string | undefined): FetchLike | undefined {
  const internal = internalBaseUrl?.replace(/\/$/, "");
  if (!internal) return undefined;

  const rewrite = (url: string): string => {
    return url
      .replace(/^https:\/\/localhost:8080(?=\/|$)/, internal)
      .replace(/^http:\/\/localhost:8080(?=\/|$)/, internal)
      .replace(/^https:\/\/127\.0\.0\.1:8080(?=\/|$)/, internal)
      .replace(/^http:\/\/127\.0\.0\.1:8080(?=\/|$)/, internal);
  };

  return async (input, init) => {
    if (typeof input === "string") {
      return fetch(rewrite(input), init);
    }
    if (input instanceof URL) {
      return fetch(rewrite(input.href), init);
    }
    if (input instanceof Request) {
      return fetch(rewrite(input.url), init);
    }
    return fetch(input, init);
  };
}
