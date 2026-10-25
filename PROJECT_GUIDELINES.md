# VeckansMat — Product and Project Guidelines

This document records product decisions and shared project guidelines for VeckansMat. Update it as decisions are made so future work follows the same goals without the family having to repeat them.

**Live app:** [https://veckansmat.veckans-mat.workers.dev](https://veckansmat.veckans-mat.workers.dev)

## Product goal

VeckansMat is a private family app for managing recipes, their ingredients and instructions, and shopping lists. Weekly meal planning may be added as a separate feature. It should make it easy for the family to collect, find, edit, and use recipes.

## Agreed guidelines

- **Mobile first.** The app will be used mainly on phones. Prioritize a clear layout, readable text, large touch targets, and smooth forms on small screens. Desktop should work well too, but is secondary.
- **Built for family use.** The audience is the family, not an open recipe community.
- **Recipes can be created and edited.** Family members need to add recipes and edit existing ones.
- **Recipe content.** A recipe can include a title, ingredients, and method.
- **Shopping lists are part of the core product.** The family should be able to manage a shopping list and add recipe ingredients to it; the exact flow is still to be designed.
- **Categories and attributes.** Recipes should support favorites, kid-friendly labels, and food types such as meat, fish, and vegetarian. They should also support a difficulty level such as easy, medium, or hard. More labels can be added as needs emerge.
- **English is the standard language for project files, documentation, and the current user interface.**

## Mobile and interface requirements

- Design and check each main flow on a narrow phone screen first.
- Keep primary actions easy to reach and tap with one hand.
- Avoid precision tapping, tiny controls, and unnecessarily long forms.
- Give clear feedback when saving, when something goes wrong, and before destructive actions.
- Maintain good contrast, visible focus states, semantic headings, and accessible names for buttons and icons.
- Adapt the layout to larger screens without making the mobile experience worse.

## Recipe model — proposed starting point

This is a working model, not a fixed technical schema:

- Name/title
- Short description (optional)
- Ingredients as separate rows, with amount and unit where useful
- Method as ordered steps
- Prep and cook time (optional)
- Servings (optional)
- Food type, such as meat, fish, or vegetarian
- Labels, such as kid-friendly and favorite
- Difficulty: easy, medium, or hard

Keep the data model easy to extend. Do not make optional fields required without a confirmed product need.

## Access and data security

- **Chosen access model: one shared family PIN.** Family members use the same PIN to unlock the app; individual accounts are not required.
- Verify the PIN on the server. Never embed it in Angular code, browser storage, or a public configuration file.
- On successful verification, issue a time-limited session in an HttpOnly, Secure (in production), SameSite cookie. Do not store session tokens in local storage.
- Rate-limit failed PIN attempts. Use HTTPS in production and keep the PIN in Cloudflare Worker secrets or an untracked local development secrets file.
- Protect every recipe write endpoint on the server, not only by hiding controls in the interface.
- Because the PIN is shared, anyone who learns it has the same access. Plan for changing the PIN and invalidating existing sessions.
- Keep a separate database export and protect against accidental deletion.

### Current implementation status

- The Angular app has a shared-PIN unlock screen and a lock action.
- A Cloudflare Worker handles the API and serves the Angular static assets. D1 stores recipe data, shopping lists, PIN-attempt limits, and hashed session tokens.
- The D1 database and initial remote schema migration are in place. The Worker and Angular app are deployed at the live URL above.
- Recipes can be saved with structured ingredients, ordered method steps, food type, difficulty, favorite and kid-friendly attributes. Shopping lists support manual items and adding ingredients from recipes.
- The production PIN is configured as a Cloudflare Worker secret. The local development PIN belongs in `.dev.vars` only; neither PIN is included in the Angular bundle or Git source.
- User preference: never write the production family PIN to a project file, command-line argument, or source control. Enter it only at Wrangler's secret-value prompt; use a separate disposable PIN for local development, or use the deployed app.
- Sessions use an HttpOnly, SameSite cookie with a 12-hour expiration. The Worker checks the session on every recipe and shopping-list API request.
- The API and schema are in place; the recipe browser/editor and shopping-list screens are not yet implemented. The starter page still contains public placeholder content.
- The shared PIN remains a shared secret: anyone who learns it can make changes. The current PIN rate limit is five failed attempts per IP per 15-minute window.

### Backend architecture

The chosen low-maintenance hosting path is **phone/browser → HTTPS → Cloudflare Worker → D1 database**. The Worker checks the session cookie for protected requests. D1 credentials and the family PIN stay on the server side; the browser never connects with privileged credentials.

Cloudflare Free is the target plan, with no custom domain required. Keep a periodic SQL export outside the repository. Review current quotas and backup/restore steps when changing hosting or depending on new platform features.

## Open scope question for the first version

The first useful version should support recipes, ingredients, and shopping lists. Decide whether weekly meal planning should also be included in that first version.

## Working principles

- Confirm major product decisions with the family before locking them into architecture or interface design.
- Prefer simple, understandable flows over adding more features.
- Manually check changed user journeys at phone size; check desktop too.
- Keep starter-page copy and examples in sync with features that actually exist.
- Record new decisions here and mark open questions as decided once the family has answered.

## Decisions to fill in

- Weekly meal planning in the first version: **open**
- Cloudflare account, free D1 database, and initial schema: **complete**
- Live deployment, `workers.dev` subdomain, and production PIN secret: **complete**
- Whether recipes should support images: **open**
