# MotorOS identity

The identity combines a hexagonal workshop badge and a geometric M, in warm orange
(`#FF9857`) and graphite (`#151819`). The two-tone wordmark uses the same orange
accent. The mark remains legible at browser-tab sizes without fine detail.

`apps/workshop-dashboard/public/brand/motoros-mark.svg` is the master vector.
`src/components/brand.tsx` is the shared, accessible lockup used by public, account,
management, registry, operations and workshop screens. It has no client state or
runtime dependency. Text inherits the current theme for light and dark workspaces.

Next.js discovers the root `src/app/icon.svg`, multi-resolution `favicon.ico`
(16, 32 and 48 pixels) and `apple-icon.png` (180 pixels). Regenerate these from the
master vector when changing the mark; retain the explicit icon dimensions.

The local identity theme at `infrastructure/keycloak/themes/motoros/login` inherits
the upstream Keycloak v2 forms. Only assets and presentation are customized; password,
registration, verification, PKCE and recovery behavior stay with Keycloak. Compose
mounts this theme read-only. Realm preparation and configuration select it persistently.
The theme's mark and favicon are copies of the same master and app favicon; update
them together. No Google branding or Gmail account settings are modified.

Browser coverage in `tests/e2e/branding.spec.ts` checks shared public/account branding,
loaded images, valid tab icons, responsive widths and identity-theme assets. The
existing authenticated OIDC/workshop test checks the preserved workspace flow.

Deployment note: the Next.js image includes the new assets. A remotely managed
identity provider must be branded through its own supported deployment process;
this local Keycloak theme does not configure Cognito hosted UI branding.
