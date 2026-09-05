# Deferred migrations

Migrations that are **written, reviewed, and deliberately NOT applied.** They live outside
`supabase/migrations/` for one reason: `supabase db push` applies every migration in that
directory that the remote ledger does not list as applied. A deferred migration left there is
one `db push` away from going live by accident.

Moving a file here is the only way to defer it honestly. The alternative — marking it `applied`
in the ledger — would be a lie that hides a schema difference from everyone who reads it later.

## To activate one

```bash
git mv supabase/migrations-deferred/<file> supabase/migrations/
supabase migration list          # confirm it now shows LOCAL with no REMOTE
supabase db push
```

---

## `0006_roles_admin.sql` — adds `'admin'` to `profiles.role`

**Verified not applied (2026-09-05):** the live constraint is
`CHECK (role = ANY (ARRAY['student','teacher']))`.

Its original hazard is closed. `0013` made `profiles.role` immutable to ordinary updates and
`handle_new_user` stopped trusting signup metadata, so widening the constraint can no longer be
exploited to self-promote to admin.

It stays deferred anyway, because **safe is not the same as wanted**: nothing uses an admin role
yet. Apply it when admin is actually built — that is piece 3 of the redesign, and spec
`2026-09-04-child-safety-and-consent-design.md` §12 describes what it must do.
