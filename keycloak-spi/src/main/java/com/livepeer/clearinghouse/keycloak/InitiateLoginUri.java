package com.livepeer.clearinghouse.keycloak;

import org.keycloak.models.ClientModel;

/**
 * Client attribute for OIDC third-party initiate login (Dashboard URL).
 */
public final class InitiateLoginUri {

    public static final String CLIENT_ATTRIBUTE = "initiate.login.uri";
    public static final String LINKED_PUBLIC_CLIENT_ATTRIBUTE = "linked.public.client.id";

    private InitiateLoginUri() {}

    public static String read(ClientModel client) {
        if (client == null) {
            return null;
        }
        String value = client.getAttribute(CLIENT_ATTRIBUTE);
        return value == null || value.isBlank() ? null : value.trim();
    }

    public static String linkedPublicClientId(ClientModel m2mClient) {
        if (m2mClient == null) {
            return null;
        }
        String value = m2mClient.getAttribute(LINKED_PUBLIC_CLIENT_ATTRIBUTE);
        return value == null || value.isBlank() ? null : value.trim();
    }
}
