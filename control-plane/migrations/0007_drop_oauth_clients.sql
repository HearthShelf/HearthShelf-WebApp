-- Drop the legacy per-server Clerk OAuth client table.
--
-- The old hosted-auth flow gave each paired server a dedicated Clerk OAuth client
-- (ABS-as-OIDC-client). Hosted sign-in is now HS-owned: the box mints a per-user
-- ABS token on demand from a control-plane grant, so no Clerk OAuth client is ever
-- created. The oauth_clients table and all its code are gone.
--
-- NOTE: any Clerk OAuth *application* created by the old code for an
-- already-paired server is orphaned by this drop (it can no longer be revoked via
-- deregister). There is exactly one such legacy app at the time of this migration
-- (the original test server); delete it manually in the Clerk dashboard. New
-- servers never create one.

DROP TABLE IF EXISTS oauth_clients;
