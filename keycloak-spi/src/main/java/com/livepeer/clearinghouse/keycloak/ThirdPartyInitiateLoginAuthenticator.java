package com.livepeer.clearinghouse.keycloak;

import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriBuilder;
import java.net.URI;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;
import org.keycloak.protocol.oidc.grants.device.DeviceGrantType;
import org.keycloak.services.Urls;
import org.keycloak.sessions.AuthenticationSessionModel;

/**
 * Redirects OAuth 2.0 device verification to the Dashboard (third-party initiate login).
 */
public class ThirdPartyInitiateLoginAuthenticator implements Authenticator {

    private static final String REDIRECTED_NOTE = "clearinghouse_initiate_login_redirected";

    @Override
    public void authenticate(AuthenticationFlowContext context) {
        AuthenticationSessionModel authSession = context.getAuthenticationSession();
        if (!DeviceGrantType.isOAuth2DeviceVerificationFlow(authSession)) {
            context.attempted();
            return;
        }

        if ("true".equals(authSession.getAuthNote(REDIRECTED_NOTE))) {
            context.attempted();
            return;
        }

        ClientModel client = authSession.getClient();
        String initiateUri = InitiateLoginUri.read(client);
        if (initiateUri == null) {
            context.attempted();
            return;
        }

        String userCode = authSession.getClientNote(DeviceGrantType.OAUTH2_DEVICE_VERIFIED_USER_CODE);
        if (userCode == null || userCode.isBlank()) {
            context.attempted();
            return;
        }

        RealmModel realm = context.getRealm();
        KeycloakSession session = context.getSession();
        String issuer = Urls.realmIssuer(session.getContext().getUri().getBaseUri(), realm.getName());

        URI deviceReturn = UriBuilder.fromUri(issuer)
                .path("device")
                .queryParam("user_code", userCode)
                .queryParam("client_id", client.getClientId())
                .queryParam("iss", issuer)
                .build();

        String redirect = UriBuilder.fromUri(initiateUri)
                .queryParam("iss", issuer)
                .queryParam("target_link_uri", deviceReturn.toString())
                .build()
                .toString();

        authSession.setAuthNote(REDIRECTED_NOTE, "true");
        context.challenge(Response.seeOther(URI.create(redirect)).build());
    }

    @Override
    public void action(AuthenticationFlowContext context) {
        context.attempted();
    }

    @Override
    public boolean requiresUser() {
        return false;
    }

    @Override
    public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
        return true;
    }

    @Override
    public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {
        // no-op
    }

    @Override
    public void close() {
        // no-op
    }
}
