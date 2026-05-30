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
import org.keycloak.models.OAuth2DeviceCodeModel;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.TokenExchangeContext;
import org.keycloak.protocol.oidc.TokenExchangeProvider;
import org.keycloak.protocol.oidc.TokenManager;
import org.keycloak.protocol.oidc.grants.device.DeviceGrantType;
import org.keycloak.protocol.oidc.grants.device.endpoints.DeviceEndpoint;
import org.keycloak.representations.AccessToken;
import org.keycloak.representations.AccessTokenResponse;
import org.keycloak.services.CorsErrorResponseException;
import org.keycloak.services.cors.Cors;
import org.keycloak.services.managers.AuthenticationManager;

/**
 * RFC 8693 token exchange that binds a pending device code using a user access token
 * (builder-sdk {@code urn:pmth:device_code:} resource).
 */
public class DeviceApprovalTokenExchangeProvider implements TokenExchangeProvider {

    private static final Set<String> APPROVE_SCOPES = Set.of("device:approve", "users:token");

    @Override
    public boolean supports(TokenExchangeContext context) {
        String resource = context.getParams().getResource();
        return DeviceCodeResource.isDeviceApprovalResource(resource);
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

        if (!clientAllowsDeviceApproval(m2mClient)) {
            throw invalidRequest(cors, "Missing device:approve or users:token scope");
        }

        String resource = context.getParams().getResource();
        String userCodeRaw = DeviceCodeResource.parseUserCode(resource);
        if (userCodeRaw == null) {
            throw invalidRequest(cors, "Invalid device code resource");
        }

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
                    cors, OAuthErrorException.INVALID_GRANT, "Invalid subject token", Response.Status.BAD_REQUEST);
        }

        AccessToken accessToken = authResult.getToken();
        String publicClientId = resolvePublicClientId(accessToken, m2mClient);
        if (publicClientId == null) {
            throw invalidRequest(cors, "Could not resolve public client for device approval");
        }

        String tokenClientId = accessToken.getIssuedFor();
        if (tokenClientId == null || !tokenClientId.equals(publicClientId)) {
            throw invalidRequest(cors, "subject_token must be issued to the linked public client");
        }

        UserSessionModel userSession = authResult.getSession();
        if (userSession == null) {
            throw invalidRequest(cors, "subject_token has no user session");
        }

        var userCodeProvider = session.getProvider(org.keycloak.models.OAuth2DeviceUserCodeProvider.class);
        String formattedUserCode = userCodeProvider.format(DeviceCodeResource.normalizeUserCode(userCodeRaw));

        OAuth2DeviceCodeModel deviceCode = DeviceEndpoint.getDeviceByUserCode(session, realm, formattedUserCode);
        if (deviceCode == null) {
            throw new CorsErrorResponseException(
                    cors,
                    OAuthErrorException.INVALID_GRANT,
                    "Invalid or expired device user code",
                    Response.Status.BAD_REQUEST);
        }

        if (!publicClientId.equals(deviceCode.getClientId())) {
            throw invalidRequest(cors, "Device code was issued to a different client");
        }

        if (!DeviceGrantType.approveUserCode(session, realm, formattedUserCode, userSession.getId(), null)) {
            throw new CorsErrorResponseException(
                    cors,
                    OAuthErrorException.INVALID_GRANT,
                    "Device code could not be approved",
                    Response.Status.BAD_REQUEST);
        }

        AccessTokenResponse response = new AccessTokenResponse();
        response.setToken(subjectToken);
        response.setTokenType("Bearer");
        if (accessToken.getExp() != 0) {
            long now = System.currentTimeMillis() / 1000;
            response.setExpiresIn(Math.max(accessToken.getExp() - now, 0));
        }
        response.setScope(accessToken.getScope());
        // RFC 8693 requires issued_token_type. KC 26's AccessTokenResponse has no setter for it,
        // so emit it via otherClaims (serialized to the JSON root by @JsonAnyGetter).
        response.setOtherClaims(OAuth2Constants.ISSUED_TOKEN_TYPE, OAuth2Constants.ACCESS_TOKEN_TYPE);
        event.success();
        return cors.add(Response.ok(response, MediaType.APPLICATION_JSON_TYPE));
    }

    private static boolean clientAllowsDeviceApproval(ClientModel client) {
        for (String scope : APPROVE_SCOPES) {
            if (client.getClientScopes(true).containsKey(scope)
                    || client.getClientScopes(false).containsKey(scope)) {
                return true;
            }
        }
        return false;
    }

    private static String resolvePublicClientId(AccessToken token, ClientModel m2mClient) {
        String linked = InitiateLoginUri.linkedPublicClientId(m2mClient);
        if (linked != null) {
            return linked;
        }
        String issuedFor = token.getIssuedFor();
        if (issuedFor != null && issuedFor.startsWith("app_")) {
            return issuedFor;
        }
        return null;
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
