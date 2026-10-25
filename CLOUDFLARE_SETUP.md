# Cloudflare deployment and operations

## Live app

[Open VeckansMat](https://veckansmat.veckans-mat.workers.dev)

The Angular app and API run in one Cloudflare Worker. Recipe and shopping-list data, session records, and PIN attempt limits are stored in the D1 database named `veckansmat`. The production family PIN is configured as the Worker secret `FAMILY_PIN`; its value is not stored in this repository.

The app uses the Cloudflare Free plan and does not require a custom domain. Keep the account on Free unless the family explicitly chooses to upgrade.

## Current feature status

The shared-PIN gate and backend are deployed. The API supports recipes with structured ingredients and ordered method steps, and shopping lists with manual items or ingredients added from recipes. The recipe browser/editor and shopping-list screens are not implemented yet; the deployed page is still the starter landing page.

## Deploying code changes

Wrangler is installed as a project development dependency. After logging into the Cloudflare account with `npx wrangler login`, deploy the current Angular app and Worker with:

```powershell
npm run deploy
```

When changing the database schema, add a numbered SQL migration in `migrations/`, then apply it remotely:

```powershell
npm run db:remote
```

Apply the migration before deploying code that depends on the new schema.

## PIN management

Set or rotate the production PIN without putting its value in a file or command argument:

```powershell
npx wrangler secret put FAMILY_PIN
```

Wrangler prompts for the secret value and deploys the updated Worker. Enter the PIN only at that prompt. The app requires an 8–12 digit PIN. To invalidate every active session immediately after rotating the PIN:

```powershell
npx wrangler d1 execute veckansmat --remote --command "DELETE FROM auth_sessions"
```

Everyone shares the same permission. Anyone who learns the PIN can edit or delete family data.

## Local development

Local Wrangler development does not download the production secret. If you want to run the API locally:

1. Copy `.dev.vars.example` to `.dev.vars` and set a separate local-only test PIN. Never copy the production PIN into a file.
2. Apply the schema to the local D1 database:

   ```powershell
   npm run db:local
   ```

3. Run `npm run api` in one terminal and `npm start` in another.
4. Open `http://localhost:4200/`.

The Angular dev server proxies `/api` to the local Worker at port 8787. Running `npm start` alone does not start the API. If you prefer not to keep any PIN in a local file, use the deployed app instead.

## Backups and free-plan limits

Cloudflare provides seven days of D1 point-in-time recovery on the Free plan. Also make periodic SQL exports and keep them outside the repository, for example in Documents:

```powershell
npx wrangler d1 export veckansmat --remote --output="$env:USERPROFILE\Documents\veckansmat-backup.sql"
```

Current published Free limits include 100,000 Worker requests per day, 5 million D1 rows read per day, 100,000 D1 rows written per day, and 500 MB per D1 database. If a D1 free quota is exceeded, D1 queries can fail until the limit resets; they do not automatically switch to paid usage.

For a separate Cloudflare account or a fresh setup, create a free Cloudflare account, run `npx wrangler login`, create a D1 database with `npx wrangler d1 create veckansmat`, put its ID in `wrangler.jsonc`, apply `npm run db:remote`, set the `FAMILY_PIN` secret, then run `npm run deploy`. Cloudflare advertises the Workers Free plan as requiring no credit card.
