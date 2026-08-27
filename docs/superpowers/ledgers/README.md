# Ledger archive

Redacted copies of the SDD ledgers from each milestone's implementation run.

The live ledgers live at `.superpowers/sdd/<plan>/progress.md`, which is
gitignored and machine-local — the process deletes that workspace when a
branch finishes, so these copies exist to keep the reasoning after the
scratch directory is gone.

**What is in them:** every commit, every ruling with what it costs if wrong,
every finding a reviewer raised and how it was resolved or why it was parked.
They are the *why* behind the code. `project_state.md` carries what a fresh
session needs to act; these carry what it needs to understand.

**They are redacted.** One credential appeared in the M2 ledger and has been
replaced with a marker. Check any future copy the same way before committing
it — a secret in git history is much harder to remove than a secret in a
gitignored file.

**They are snapshots, not living documents.** If a milestone continues after
its copy was taken, the machine-local ledger is the authority.
