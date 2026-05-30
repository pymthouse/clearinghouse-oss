package com.livepeer.clearinghouse.keycloak;

/**
 * RFC 8707 resource indicator for device approval token exchange (matches builder-sdk).
 */
public final class DeviceCodeResource {

    public static final String PREFIX = "urn:pmth:device_code:";

    private DeviceCodeResource() {}

    public static boolean isDeviceApprovalResource(String resource) {
        return resource != null && resource.trim().startsWith(PREFIX);
    }

    public static String parseUserCode(String resource) {
        if (!isDeviceApprovalResource(resource)) {
            return null;
        }
        String code = resource.trim().substring(PREFIX.length()).trim();
        return code.isEmpty() ? null : code;
    }

    /** Uppercase alphanumeric user code for Keycloak lookup. */
    public static String normalizeUserCode(String userCode) {
        return userCode.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
    }
}
