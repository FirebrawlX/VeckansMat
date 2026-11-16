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

Production has migrations through `0010_pantry_items.sql` (applied 2026-10-26). For future schema changes, add a numbered migration and apply it remotely before deploying code that depends on it.

## Secrets and backups

- Set or rotate the 8–12 digit production PIN with `npx wrangler secret put FAMILY_PIN`; enter it only at Wrangler's prompt.
- Coop offers are fetched weekly by the GitHub Actions workflow in `.github/workflows/coop-offers.yml`. It uses the official Stora Coop Lund offers page and its linked PDF; it checks the exact store, current week, PDF store footer, printed validity dates, all ten category counts, and every listed card before publishing. Any failed check leaves the last published catalog unchanged.
- The source is Coop's online store-offers list, not a proven complete transcription of every PDF-only offer. The Offers page displays this limitation and links to the PDF. An unclear offer price or an incomplete category list blocks the whole import.
- To enable the workflow, create a random token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Add the same value as the Cloudflare secret using `npx wrangler secret put OFFER_AUTOMATION_TOKEN`, then as a GitHub Actions repository secret named `OFFER_AUTOMATION_TOKEN`. Do not put the token in source files or commit it.
- Before deploying this feature, apply the additive D1 tables with `npm run db:remote`, then deploy with `npm run deploy`. The weekly action can be tested after deployment with `npm run offers:dry-run` locally or the workflow's **Run workflow** button in GitHub.
- GitHub Actions is limited to one scheduled run per week and has a 10-minute job timeout. It has no paid fallback; if the free quota or the run is unavailable, the last published offers remain available.
- To revoke active sessions after a rotation: `npx wrangler d1 execute veckansmat --remote --command "DELETE FROM auth_sessions"`.
- Export backups outside the repository: `npx wrangler d1 export veckansmat --remote --output="$env:USERPROFILE\Documents\veckansmat-backup.sql"`.
- Production app: [veckansmat.veckans-mat.workers.dev](https://veckansmat.veckans-mat.workers.dev).
