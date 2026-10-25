# Gmail for local account emails

This optional configuration sends real identity verification and password-reset emails.
Workshop notifications continue using Mailpit. Gmail is not enabled by default.

1. Enable Google 2-Step Verification and create an App Password named MotorOS at
   <https://myaccount.google.com/apppasswords>. Some managed or Advanced Protection
   accounts cannot use App Passwords. Never use your normal Google password.
2. With local Keycloak running, open a terminal in the repository and run
   `node scripts/setup-gmail.mjs`. This does not require PowerShell script execution
   or a change to Windows execution policy. The older PowerShell wrapper remains optional.
3. Enter the sending Gmail address and paste the App Password into the hidden prompt.
   Do not send credentials in chat. The script stores configuration in the ignored
   local `.env` and local Keycloak database. Restrict access to these local files,
   database backups and generated `.runtime/keycloak` imports; they contain secrets.
4. Use registration or resend verification for an address you control. Check Inbox
   and Spam. Configuration success does not establish successful delivery.

For an existing unfinished account, an operator can run
`node scripts/send-account-setup.mjs your-own-address@example.com` after running
the normal identity configuration scripts. This sends only outstanding verification
and password-setup actions and returns to `/login`. Never use `/api/auth/callback`
as the return address of an administrative action email: that route requires an
active browser sign-in transaction. Keep the local frontend running while following
email links. A verified account with no pending actions can sign in directly.

The transport is authenticated STARTTLS at smtp.gmail.com:587. Existing users and
verification requirements are preserved. Normal startup retains the configured
identity transport. Browser tests and fixtures must use a separate Mailpit realm;
do not run synthetic registration tests against an identity realm sending real mail.

To revert, remove the three `IDENTITY_SMTP_*` entries from `.env`, then run
`node scripts/prepare-oidc.mjs` followed by `node scripts/configure-oidc.mjs`.
Revoke the App Password in Google when no longer used or after suspected exposure.
This personal mailbox setup is for development; production retains its separately
approved email-provider configuration.
