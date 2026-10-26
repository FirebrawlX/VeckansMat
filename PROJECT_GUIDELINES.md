# Agent notes

Keep these requirements in view when changing VeckansMat.

## Product

- Private family app for weekly dinner planning, recipes, and shopping lists.
- The family-facing interface is Swedish; source code and project notes are English.
- Mobile first: readable text, large touch targets, accessible labels, and clear save/error feedback.
- Prefer simple flows and preserve existing family data.

## How it works

- Angular client and Cloudflare Worker API are deployed together; D1 stores recipes, plans, lists, and sessions.
- A shared family PIN unlocks the app. Validate it on the server; never expose it in client code, files committed to Git, logs, or command arguments. Local development uses a disposable PIN in ignored `.dev.vars`.
- The Worker protects recipe, plan, list, and store-section APIs with the session cookie.
- Shopping-list ingredients are combined by name. A category chosen for an ingredient is remembered by normalized ingredient name and reused in recipes and future lists. Section names and order are shared family settings in D1.
- Add numbered SQL migrations for schema changes. Apply them before deploying code that needs them.

## Change requirements

- Keep API validation on the server, including for data entered in the UI.
- Preserve checked shopping items when refreshing generated lists where practical.
- Do not deploy or apply remote migrations unless the user asks for deployment.
- Keep the README focused on family users; put operational commands in `CLOUDFLARE_SETUP.md`.

## Database data protection

- NEVER overwrite, reset, reseed, truncate, or otherwise risk losing information already saved in the database. This applies to all AI agents and future AI-assisted changes.
- Preserve existing family data when changing schemas or database code. Prefer additive, backward-compatible migrations and explicit record-level updates.
- Before any database operation that could affect existing records, verify its scope and ensure a recoverable backup exists. Never run destructive database operations as a shortcut for development or deployment.
- Only change or delete a saved record when the user explicitly requests that specific change through the product or task.
