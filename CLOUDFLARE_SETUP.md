# Cloudflare operations

Keep this file to the few commands needed to run or deploy the app. Never record the production PIN or database exports in this repository.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars` and set a disposable local PIN.
2. Run `npm run db:local`.
3. Start `npm run api` and `npm start` in separate terminals; open `http://localhost:4200/`.

## Deploy

After logging in with `npx wrangler login`:

```powershell
npm run db:remote
npm run deploy
```

Production currently has migrations through `0004_ingredient_section_memory.sql`. For future schema changes, add a numbered migration and apply it remotely before deploying code that depends on it.

## Secrets and backups

- Set or rotate the 8–12 digit production PIN with `npx wrangler secret put FAMILY_PIN`; enter it only at Wrangler's prompt.
- To revoke active sessions after a rotation: `npx wrangler d1 execute veckansmat --remote --command "DELETE FROM auth_sessions"`.
- Export backups outside the repository: `npx wrangler d1 export veckansmat --remote --output="$env:USERPROFILE\Documents\veckansmat-backup.sql"`.
- Production app: [veckansmat.veckans-mat.workers.dev](https://veckansmat.veckans-mat.workers.dev).
