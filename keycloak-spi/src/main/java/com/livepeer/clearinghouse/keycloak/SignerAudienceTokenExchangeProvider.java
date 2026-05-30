package com.livepeer.clearinghouse.keycloak;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Set;
import org.keycloak.OAuth2Constants;
import org.keycloak.OAuthErrorException;
import org.keycloak.events.Details;
import org.keycloak.events.Errors;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.protocol.oidc.TokenExchangeContext;
import org.keycloak.protocol.oidc.TokenExchangeProvider;
import org.keycloak.representations.AccessToken;
import org.keycloak.representations.AccessTokenResponse;
import org.keycloak.services.CorsErrorResponseException;
import org.keycloak.services.cors.Cors;
import org.keycloak.services.managers.AuthenticationManager;

/**
 * RFC 8693 token exchange for per-app M2M clients: validate subject access token issued to the
 * linked public client and return it for signer use (passthrough), with strict request validation.
 */
public class SignerAudienceTokenExchangeProvider implements TokenExchangeProvider {

    /** Resource server / JWT audience for remote signer (matches realm audience mapper). */
    public static final String SIGNER_AUDIENCE = "livepeer-remote-signer";

    private static final Set<String> ALLOWED_M2M_SCOPES = Set.of("sign:job", "users:token");

    @Override
    public boolean supports(TokenExchangeContext context) {
        String resource = context.getParams().getResource();
        if (DeviceCodeResource.isDeviceApprovalResource(resource)) {
            return false;
        }

        String subjectToken = context.getParams().getSubjectToken();
        if (subjectToken == null || subjectToken.isBlank()) {
            return false;
        }

        ClientModel client = context.getClient();
        if (!client.isServiceAccountsEnabled()) {
            return false;
        }

        if (InitiateLoginUri.linkedPublicClientId(client) == null) {
            return false;
        }

        if (!clientAllowsSignerExchange(client)) {
            return false;
        }

        return requestsSignerAudience(context);
    }

    @Override
    public Response exchange(TokenExchangeContext context) {
        KeycloakSession session = context.getSession();
        RealmModel realm = context.getRealm();
        ClientModel m2mClient = context.getClient();
        var event = context.getEvent();
        Cors cors = context.getCors();
        var formParams = context.getFormParams();

        if (!m2mClient.isServiceAccountsEnabled()) {
            throw invalidRequest(cors, "Client must be a confidential service account");
        }

        if (!clientAllowsSignerExchange(m2mClient)) {
            throw invalidRequest(cors, "Missing sign:job or users:token scope on M2M client");
        }

        String publicClientId = InitiateLoginUri.linkedPublicClientId(m2mClient);
        if (publicClientId == null) {
            throw invalidRequest(cors, "M2M client missing linked.public.client.id");
        }

        assertSignerAudienceRequested(context, cors);

        String subjectToken = context.getParams().getSubjectToken();
        if (subjectToken == null || subjectToken.isBlank()) {
            throw invalidRequest(cors, "subject_token is required");
        }

        String subjectTokenType = formParams.getFirst(OAuth2Constants.SUBJECT_TOKEN_TYPE);
        if (subjectTokenType == null || subjectTokenType.isBlank()) {
            throw invalidRequest(cors, "subject_token_type is required");
        }
        if (!OAuth2Constants.ACCESS_TOKEN_TYPE.equals(subjectTokenType)) {
            throw invalidRequest(cors, "subject_token_type must be access_token");
        }

        String requestedTokenType = formParams.getFirst(OAuth2Constants.REQUESTED_TOKEN_TYPE);
        if (requestedTokenType != null
                && !requestedTokenType.isBlank()
                && !OAuth2Constants.ACCESS_TOKEN_TYPE.equals(requestedTokenType)) {
            throw invalidRequest(cors, "requested_token_type must be access_token or omitted");
        }

        AuthenticationManager.AuthResult authResult = AuthenticationManager.verifyIdentityToken(
                        session,
                        realm,
                        session.getContext().getUri(),
                        context.getClientConnection(),
                        true,
                        true,
                        null,
                        false,
                        subjectToken,
                        context.getHeaders());
        if (authResult == null) {
            event.detail(Details.REASON, "subject_token validation failure");
            event.error(Errors.INVALID_TOKEN);
            throw new CorsErrorResponseException(
                    cors,
                    OAuthErrorException.INVALID_GRANT,
                    "Invalid subject token",
                    Response.Status.BAD_REQUEST);
        }

        AccessToken accessToken = authResult.getToken();
        String tokenClientId = accessToken.getIssuedFor();
        if (tokenClientId == null || !tokenClientId.equals(publicClientId)) {
            throw invalidRequest(
                    cors, "subject_token must have been issued to the linked public client");
        }

        ClientModel publicClient = realm.getClientByClientId(publicClientId);
        if (publicClient == null || publicClient.isBearerOnly()) {
            throw invalidRequest(cors, "Linked public client is not a valid OIDC client");
        }

        AccessTokenResponse response = new AccessTokenResponse();
        response.setToken(subjectToken);
        response.setTokenType("Bearer");
        if (accessToken.getExp() != 0) {
            long now = System.currentTimeMillis() / 1000;
            response.setExpiresIn(Math.max(accessToken.getExp() - now, 0));
        }
        response.setScope(accessToken.getScope());
        response.setOtherClaims(OAuth2Constants.ISSUED_TOKEN_TYPE, OAuth2Constants.ACCESS_TOKEN_TYPE);
        event.success();
        return cors.add(Response.ok(response, MediaType.APPLICATION_JSON_TYPE));
    }

    private static boolean requestsSignerAudience(TokenExchangeContext context) {
        String audience = context.getParams().getAudience();
        if (audience != null && !audience.isBlank() && SIGNER_AUDIENCE.equals(audience.trim())) {
            return true;
        }
        String resource = context.getParams().getResource();
        return resource != null && !resource.isBlank() && SIGNER_AUDIENCE.equals(resource.trim());
    }

    private static void assertSignerAudienceRequested(TokenExchangeContext context, Cors cors) {
        if (!requestsSignerAudience(context)) {
            throw invalidRequest(cors, "audience or resource must be " + SIGNER_AUDIENCE);
        }
    }

    private static boolean clientAllowsSignerExchange(ClientModel client) {
        for (String scope : ALLOWED_M2M_SCOPES) {
            if (client.getClientScopes(true).containsKey(scope)
                    || client.getClientScopes(false).containsKey(scope)) {
                return true;
            }
        }
        return false;
    }

    private static CorsErrorResponseException invalidRequest(Cors cors, String description) {
        return new CorsErrorResponseException(
                cors, OAuthErrorException.INVALID_REQUEST, description, Response.Status.BAD_REQUEST);
    }

    @Override
    public void close() {
        // no-op
    }
}
