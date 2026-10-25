const SESSION_COOKIE = 'veckansmat_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_ATTEMPT_LIMIT = 5;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        console.error('API request failed', error);
        const status = error instanceof ApiError ? error.status : 500;
        const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
        return json({ error: message }, status);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    return json({ authenticated: Boolean(await getSession(request, env.DB)) });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/unlock') {
    return unlock(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = await getSession(request, env.DB);
    if (session) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(session.hash).run();
    return json({ authenticated: false }, 200, { 'Set-Cookie': expiredCookie(request) });
  }

  if (!(await getSession(request, env.DB))) {
    return json({ error: 'Authentication required.' }, 401);
  }

  if (request.method === 'GET' && url.pathname === '/api/recipes') {
    return listRecipes(env.DB);
  }

  if (request.method === 'POST' && url.pathname === '/api/recipes') {
    const body = await readBody(request);
    const recipe = normalizeRecipe(body);
    if (!recipe) return json({ error: 'Enter a recipe title and valid recipe details.' }, 400);
    return saveRecipe(env.DB, recipe);
  }

  const recipeMatch = url.pathname.match(/^\/api\/recipes\/([\w-]+)$/);
  if (recipeMatch && request.method === 'GET') return getRecipe(env.DB, recipeMatch[1]);
  if (recipeMatch && request.method === 'PUT') {
    const body = await readBody(request);
    const recipe = normalizeRecipe(body);
    if (!recipe) return json({ error: 'Enter a recipe title and valid recipe details.' }, 400);
    return saveRecipe(env.DB, recipe, recipeMatch[1]);
  }
  if (recipeMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(recipeMatch[1]).run();
    return json({ deleted: true });
  }

  if (request.method === 'GET' && url.pathname === '/api/shopping-lists') {
    return listShoppingLists(env.DB);
  }
  if (request.method === 'POST' && url.pathname === '/api/shopping-lists') {
    const body = await readBody(request);
    const title = cleanText(body.title, 100);
    if (!title) return json({ error: 'Enter a list name.' }, 400);
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare('INSERT INTO shopping_lists (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, title, now, now).run();
    return json({ id, title, createdAt: now, updatedAt: now, items: [] }, 201);
  }

  const listMatch = url.pathname.match(/^\/api\/shopping-lists\/([\w-]+)$/);
  if (listMatch && request.method === 'PATCH') {
    const body = await readBody(request);
    const title = cleanText(body.title, 100);
    if (!title) return json({ error: 'Enter a list name.' }, 400);
    const result = await env.DB.prepare('UPDATE shopping_lists SET title = ?, updated_at = ? WHERE id = ?')
      .bind(title, Date.now(), listMatch[1]).run();
    if (!result.meta.changes) return json({ error: 'Shopping list not found.' }, 404);
    return json({ id: listMatch[1], title });
  }
  if (listMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM shopping_lists WHERE id = ?').bind(listMatch[1]).run();
    return json({ deleted: true });
  }

  const listRecipesMatch = url.pathname.match(/^\/api\/shopping-lists\/([\w-]+)\/from-recipes$/);
  if (listRecipesMatch && request.method === 'POST') {
    return addRecipesToShoppingList(request, env.DB, listRecipesMatch[1]);
  }

  const listItemsMatch = url.pathname.match(/^\/api\/shopping-lists\/([\w-]+)\/items$/);
  if (listItemsMatch && request.method === 'POST') {
    return addShoppingItem(request, env.DB, listItemsMatch[1]);
  }

  const itemMatch = url.pathname.match(/^\/api\/shopping-list-items\/([\w-]+)$/);
  if (itemMatch && request.method === 'PATCH') return updateShoppingItem(request, env.DB, itemMatch[1]);
  if (itemMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM shopping_list_items WHERE id = ?').bind(itemMatch[1]).run();
    return json({ deleted: true });
  }

  return json({ error: 'Not found.' }, 404);
}

async function unlock(request, env) {
  if (!env.FAMILY_PIN || !/^\d{8,12}$/.test(env.FAMILY_PIN)) {
    return json({ error: 'The family PIN has not been configured correctly.' }, 503);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const now = Date.now();
  await env.DB.prepare('DELETE FROM pin_attempts WHERE window_started <= ?').bind(now - PIN_WINDOW_MS).run();
  const attempt = await env.DB.prepare('SELECT window_started, attempts FROM pin_attempts WHERE ip = ?').bind(ip).first();
  const inWindow = attempt && now - attempt.window_started < PIN_WINDOW_MS;
  const count = inWindow ? attempt.attempts : 0;
  if (count >= PIN_ATTEMPT_LIMIT) {
    return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const candidate = typeof body.pin === 'string' ? body.pin : '';
  const isValid = /^\d{8,12}$/.test(candidate) && constantTimeEqual(candidate, env.FAMILY_PIN);
  if (!isValid) {
    const startedAt = inWindow ? attempt.window_started : now;
    await env.DB.prepare(`INSERT INTO pin_attempts (ip, window_started, attempts) VALUES (?, ?, 1)
      ON CONFLICT(ip) DO UPDATE SET window_started = excluded.window_started,
      attempts = CASE WHEN pin_attempts.window_started = excluded.window_started THEN pin_attempts.attempts + 1 ELSE 1 END`)
      .bind(ip, startedAt).run();
    return json({ error: 'That PIN is not correct.' }, 401);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM pin_attempts WHERE ip = ?').bind(ip),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
  ]);
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, expires_at) VALUES (?, ?)')
    .bind(tokenHash, expiresAt).run();
  return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
}

async function getSession(request, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const row = await db.prepare('SELECT token_hash, expires_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, Date.now()).first();
  return row ? { hash: row.token_hash } : null;
}

function normalizeRecipe(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const title = cleanText(body.title, 160);
  if (!title || !Array.isArray(body.ingredients) || !Array.isArray(body.steps)) return null;
  if (body.ingredients.length > 200 || body.steps.length > 100) return null;
  const ingredients = body.ingredients.map((item, index) => ({
    name: cleanText(item?.name, 160),
    amount: cleanText(item?.amount, 40),
    unit: cleanText(item?.unit, 40),
    position: index,
  }));
  const steps = body.steps.map((item, index) => ({
    instruction: cleanText(typeof item === 'string' ? item : item?.instruction, 4000),
    position: index,
  }));
  if (ingredients.some((item) => !item.name) || steps.some((item) => !item.instruction)) return null;
  const allowedTypes = new Set(['meat', 'fish', 'vegetarian', 'vegan', 'other']);
  const allowedDifficulties = new Set(['easy', 'medium', 'hard']);
  const intOrNull = (value) => Number.isInteger(value) && value >= 0 && value <= 1440 ? value : null;
  return {
    title,
    description: cleanText(body.description, 2000),
    prepMinutes: intOrNull(body.prepMinutes),
    cookMinutes: intOrNull(body.cookMinutes),
    servings: Number.isInteger(body.servings) && body.servings > 0 && body.servings <= 100 ? body.servings : null,
    foodType: allowedTypes.has(body.foodType) ? body.foodType : 'other',
    difficulty: allowedDifficulties.has(body.difficulty) ? body.difficulty : 'medium',
    favorite: body.favorite === true,
    kidFriendly: body.kidFriendly === true,
    ingredients,
    steps,
  };
}

async function listRecipes(db) {
  const { results: recipes } = await db.prepare('SELECT * FROM recipes ORDER BY updated_at DESC').all();
  if (!recipes.length) return json([]);
  const [ingredientRows, stepRows] = await Promise.all([
    db.prepare('SELECT * FROM recipe_ingredients ORDER BY recipe_id, position').all(),
    db.prepare('SELECT * FROM recipe_steps ORDER BY recipe_id, position').all(),
  ]);
  return json(recipes.map((recipe) => toRecipe(recipe, ingredientRows.results, stepRows.results)));
}

async function getRecipe(db, id) {
  const recipe = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first();
  if (!recipe) return json({ error: 'Recipe not found.' }, 404);
  const [ingredients, steps] = await Promise.all([
    db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position').bind(id).all(),
    db.prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY position').bind(id).all(),
  ]);
  return json(toRecipe(recipe, ingredients.results, steps.results));
}

async function saveRecipe(db, recipe, existingId = null) {
  const id = existingId ?? crypto.randomUUID();
  const now = Date.now();
  const existing = existingId ? await db.prepare('SELECT created_at FROM recipes WHERE id = ?').bind(existingId).first() : null;
  if (existingId && !existing) return json({ error: 'Recipe not found.' }, 404);
  const statements = [db.prepare(`INSERT INTO recipes
    (id, title, description, prep_minutes, cook_minutes, servings, food_type, difficulty, favorite, kid_friendly, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
    prep_minutes=excluded.prep_minutes, cook_minutes=excluded.cook_minutes, servings=excluded.servings,
    food_type=excluded.food_type, difficulty=excluded.difficulty, favorite=excluded.favorite,
    kid_friendly=excluded.kid_friendly, updated_at=excluded.updated_at`)
    .bind(id, recipe.title, recipe.description, recipe.prepMinutes, recipe.cookMinutes, recipe.servings,
      recipe.foodType, recipe.difficulty, Number(recipe.favorite), Number(recipe.kidFriendly), existing?.created_at ?? now, now)];
  if (existingId) {
    statements.push(db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').bind(id));
  }
  const ingredientRows = recipe.ingredients.map((ingredient) => ({ ...ingredient, id: crypto.randomUUID() }));
  const stepRows = recipe.steps.map((step) => ({ ...step, id: crypto.randomUUID() }));
  for (const ingredient of ingredientRows) {
    statements.push(db.prepare(`INSERT INTO recipe_ingredients (id, recipe_id, name, amount, unit, position)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(ingredient.id, id, ingredient.name, ingredient.amount, ingredient.unit, ingredient.position));
  }
  for (const step of stepRows) {
    statements.push(db.prepare('INSERT INTO recipe_steps (id, recipe_id, instruction, position) VALUES (?, ?, ?, ?)')
      .bind(step.id, id, step.instruction, step.position));
  }
  await db.batch(statements);
  return json({
    id,
    title: recipe.title,
    description: recipe.description,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    servings: recipe.servings,
    foodType: recipe.foodType,
    difficulty: recipe.difficulty,
    favorite: recipe.favorite,
    kidFriendly: recipe.kidFriendly,
    ingredients: ingredientRows,
    steps: stepRows,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  }, existingId ? 200 : 201);
}

async function listShoppingLists(db) {
  const { results: lists } = await db.prepare('SELECT * FROM shopping_lists ORDER BY updated_at DESC').all();
  if (!lists.length) return json([]);
  const { results: items } = await db.prepare('SELECT * FROM shopping_list_items ORDER BY list_id, position').all();
  return json(lists.map((list) => ({
    id: list.id,
    title: list.title,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
    items: items.filter((item) => item.list_id === list.id).map(toShoppingItem),
  })));
}

async function addShoppingItem(request, db, listId) {
  const list = await db.prepare('SELECT id FROM shopping_lists WHERE id = ?').bind(listId).first();
  if (!list) return json({ error: 'Shopping list not found.' }, 404);
  const body = await readBody(request);
  const name = cleanText(body.name, 160);
  if (!name) return json({ error: 'Enter an item name.' }, 400);
  const id = crypto.randomUUID();
  const { maxPosition } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM shopping_list_items WHERE list_id = ?')
    .bind(listId).first();
  await db.batch([
    db.prepare(`INSERT INTO shopping_list_items (id, list_id, name, amount, unit, checked, recipe_id, position)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`)
      .bind(id, listId, name, cleanText(body.amount, 40), cleanText(body.unit, 40), maxPosition + 1),
    db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), listId),
  ]);
  return json({ id, name, amount: cleanText(body.amount, 40), unit: cleanText(body.unit, 40), checked: false }, 201);
}

async function addRecipesToShoppingList(request, db, listId) {
  const list = await db.prepare('SELECT id FROM shopping_lists WHERE id = ?').bind(listId).first();
  if (!list) return json({ error: 'Shopping list not found.' }, 404);
  const body = await readBody(request);
  const ids = [...new Set(Array.isArray(body.recipeIds) ? body.recipeIds.filter((id) => typeof id === 'string') : [])].slice(0, 50);
  if (!ids.length) return json({ error: 'Select at least one recipe.' }, 400);
  const placeholders = ids.map(() => '?').join(',');
  const { results: ingredients } = await db.prepare(`SELECT ri.*, r.title AS recipe_title FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id WHERE ri.recipe_id IN (${placeholders}) ORDER BY r.title, ri.position`)
    .bind(...ids).all();
  const { maxPosition } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM shopping_list_items WHERE list_id = ?')
    .bind(listId).first();
  const statements = ingredients.map((item, index) => db.prepare(`INSERT INTO shopping_list_items
    (id, list_id, name, amount, unit, checked, recipe_id, position) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .bind(crypto.randomUUID(), listId, item.name, item.amount, item.unit, item.recipe_id, maxPosition + index + 1));
  statements.push(db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), listId));
  if (statements.length > 1) await db.batch(statements);
  return json({ added: ingredients.length });
}

async function updateShoppingItem(request, db, itemId) {
  const body = await readBody(request);
  const current = await db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').bind(itemId).first();
  if (!current) return json({ error: 'Shopping list item not found.' }, 404);
  const name = body.name === undefined ? current.name : cleanText(body.name, 160);
  if (!name) return json({ error: 'Enter an item name.' }, 400);
  const amount = body.amount === undefined ? current.amount : cleanText(body.amount, 40);
  const unit = body.unit === undefined ? current.unit : cleanText(body.unit, 40);
  const checked = body.checked === undefined ? current.checked : Number(body.checked === true);
  await db.batch([
    db.prepare('UPDATE shopping_list_items SET name = ?, amount = ?, unit = ?, checked = ? WHERE id = ?')
      .bind(name, amount, unit, checked, itemId),
    db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), current.list_id),
  ]);
  return json(toShoppingItem({ ...current, name, amount, unit, checked }));
}

function toRecipe(recipe, ingredients, steps) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    prepMinutes: recipe.prep_minutes,
    cookMinutes: recipe.cook_minutes,
    servings: recipe.servings,
    foodType: recipe.food_type,
    difficulty: recipe.difficulty,
    favorite: Boolean(recipe.favorite),
    kidFriendly: Boolean(recipe.kid_friendly),
    ingredients: ingredients.filter((item) => item.recipe_id === recipe.id).map((item) => ({
      id: item.id, name: item.name, amount: item.amount, unit: item.unit, position: item.position,
    })),
    steps: steps.filter((item) => item.recipe_id === recipe.id).map((item) => ({
      id: item.id, instruction: item.instruction, position: item.position,
    })),
    createdAt: recipe.created_at,
    updatedAt: recipe.updated_at,
  };
}

function toShoppingItem(item) {
  return {
    id: item.id,
    name: item.name,
    amount: item.amount,
    unit: item.unit,
    checked: Boolean(item.checked),
    recipeId: item.recipe_id,
    position: item.position,
  };
}

async function readBody(request) {
  const text = await request.text();
  if (encoder.encode(text).length > 64 * 1024) throw new ApiError(413, 'Request body too large.');
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    throw new ApiError(400, 'Invalid request body.');
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) ?? '';
}

function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function expiredCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}
