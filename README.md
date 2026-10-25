# VeckansMat

**Live app: [Open VeckansMat](https://veckansmat.veckans-mat.workers.dev)**

A mobile-first family app for managing recipes, ingredients, instructions, and shopping lists.

## Current status

The app is deployed on Cloudflare's free Workers and D1 services. Open the live link above and enter the shared family PIN.

The shared-PIN access flow and the backend API are working. The backend supports recipe data, structured ingredients and method steps, shopping lists, manual shopping items, and adding recipe ingredients to a list. The recipe browser/editor and shopping-list screens are still being built; the current page is a starter landing page.

## Product standards and setup

- [Product and project guidelines](PROJECT_GUIDELINES.md)
- [Cloudflare setup, local development, and backups](CLOUDFLARE_SETUP.md)

The production PIN is stored as a Cloudflare Worker secret. Never put it in source code, Git, or the production app bundle. Local development should use a separate test PIN in the untracked `.dev.vars` file.

## Local development

Install dependencies:

```bash
npm install
```

If you want to run the API locally, copy `.dev.vars.example` to `.dev.vars` and set a separate local-only test PIN. Do not put the production family PIN in a file.

Apply the schema to the local D1 database:

```bash
npm run db:local
```

Run the API/asset Worker and Angular dev server in separate terminals:

```bash
npm run api
npm start
```

The Angular dev server runs at `http://localhost:4200/` and proxies `/api` to Wrangler on port 8787. Running only `npm start` does not start the API.

## Commands

```bash
npm start         # Start the Angular dev server
npm run api       # Start the local Cloudflare Worker and D1 emulator
npm run db:local  # Apply schema locally
npm run db:remote # Apply schema to the Cloudflare D1 database
npm run build     # Build the app
npm run deploy    # Build and deploy the Worker and static app
npm test          # Run unit tests
```

The Cloudflare free plan has usage quotas. Keep periodic D1 exports outside the repository; the backup instructions are in [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md).
