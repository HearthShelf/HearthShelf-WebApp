-- 0001 was generated on better-auth 1.7.2, whose account table carried an
-- `issuer` column plus a unique index over it. The runtime floated to 1.7.3
-- (the ^ range, via @better-auth/expo), which dropped that column and never
-- writes it - so with 0001 alone every account insert fails on
-- "NOT NULL constraint failed: account.issuer": sign-up 500s, and linking a
-- new social identity to an existing account dies the same way, leaving users
-- who exist but can never hold a session. This brings the table to the 1.7.3
-- shape (verified by regenerating the schema on the installed version).
drop index if exists "account_issuer_accountId_uidx";
alter table "account" drop column "issuer";
