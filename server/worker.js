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

  if (request.method === 'GET' && url.pathname === '/api/store-sections') return listStoreSections(env.DB);
  if (request.method === 'GET' && url.pathname === '/api/pantry-items') return listPantryItems(env.DB);
  if (request.method === 'POST' && url.pathname === '/api/pantry-items') return addPantryItem(request, env.DB);
  if (request.method === 'PUT' && url.pathname === '/api/store-sections') {
    const body = await readBody(request);
    if (!Array.isArray(body.sections) || body.sections.length < 1 || body.sections.length > 26) return json({ error: 'Enter at least one valid store section.' }, 400);
    const sections = body.sections.map((section, position) => ({ code: cleanText(section?.code, 4).toUpperCase(), name: cleanText(section?.name, 80), position }));
    if (sections.some((section) => !/^[A-Z]$/.test(section.code) || !section.name) || new Set(sections.map((section) => section.code)).size !== sections.length) return json({ error: 'Each section needs a unique letter and a name.' }, 400);
    const [recipeSections, listSections, pantrySections, currentSections] = await Promise.all([
      env.DB.prepare("SELECT DISTINCT section_code AS code FROM recipe_ingredients WHERE section_code != ''").all(),
      env.DB.prepare("SELECT DISTINCT section_code AS code FROM shopping_list_items WHERE section_code != ''").all(),
      env.DB.prepare("SELECT DISTINCT section_code AS code FROM pantry_items WHERE section_code != ''").all(),
      env.DB.prepare('SELECT code FROM store_sections').all(),
    ]);
    const assignedCodes = new Set([...recipeSections.results, ...listSections.results, ...pantrySections.results].map((row) => row.code));
    const submittedCodes = new Set(sections.map((section) => section.code));
    if ([...assignedCodes].some((code) => !submittedCodes.has(code))) {
      return json({ error: 'A store section is still assigned to ingredients. Move those ingredients to another section before removing it.' }, 409);
    }
    const removedCodes = currentSections.results.map((row) => row.code).filter((code) => !submittedCodes.has(code));
    const statements = [env.DB.prepare('DELETE FROM store_sections')];
    if (removedCodes.length) statements.push(env.DB.prepare(`DELETE FROM ingredient_section_memory WHERE section_code IN (${removedCodes.map(() => '?').join(',')})`).bind(...removedCodes));
    statements.push(...sections.map((section) => env.DB.prepare('INSERT INTO store_sections (code, name, position) VALUES (?, ?, ?)').bind(section.code, section.name, section.position)));
    await env.DB.batch(statements);
    return listStoreSections(env.DB);
  }

  if (request.method === 'GET' && url.pathname === '/api/recipes') {
    return listRecipes(env.DB);
  }

  if (request.method === 'POST' && url.pathname === '/api/recipes') {
    const body = await readBody(request);
    const recipe = normalizeRecipe(body);
    if (!recipe) return json({ error: 'Enter a recipe title and valid recipe details.' }, 400);
    await resolveRecipeSections(env.DB, recipe.ingredients);
    return saveRecipe(env.DB, recipe);
  }

  const recipeConfirmationMatch = url.pathname.match(/^\/api\/recipes\/([\w-]+)\/confirmation$/);
  if (recipeConfirmationMatch && request.method === 'PATCH') {
    const body = await readBody(request);
    if (typeof body.confirmed !== 'boolean') return json({ error: 'Choose a valid recipe confirmation state.' }, 400);
    if (!body.confirmed) {
      const pinError = await checkFamilyPin(request, env, body.pin);
      if (pinError) return pinError;
    }
    const result = await env.DB.prepare('UPDATE recipes SET confirmed = ? WHERE id = ?').bind(Number(body.confirmed), recipeConfirmationMatch[1]).run();
    if (!result.meta.changes) return json({ error: 'Recipe not found.' }, 404);
    return getRecipe(env.DB, recipeConfirmationMatch[1]);
  }

  const recipeMatch = url.pathname.match(/^\/api\/recipes\/([\w-]+)$/);
  if (recipeMatch && request.method === 'GET') return getRecipe(env.DB, recipeMatch[1]);
  if (recipeMatch && request.method === 'PUT') {
    const body = await readBody(request);
    const existingRecipe = await env.DB.prepare('SELECT confirmed FROM recipes WHERE id = ?').bind(recipeMatch[1]).first();
    if (existingRecipe?.confirmed) {
      const pinError = await checkFamilyPin(request, env, body.pin);
      if (pinError) return pinError;
    }
    const recipe = normalizeRecipe(body);
    if (!recipe) return json({ error: 'Enter a recipe title and valid recipe details.' }, 400);
    await resolveRecipeSections(env.DB, recipe.ingredients);
    return saveRecipe(env.DB, recipe, recipeMatch[1]);
  }
  if (recipeMatch && request.method === 'DELETE') {
    const body = await readBody(request);
    const pinError = await checkFamilyPin(request, env, body.pin);
    if (pinError) return pinError;
    await env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(recipeMatch[1]).run();
    return json({ deleted: true });
  }

  if (url.pathname === '/api/weekly-plan' && request.method === 'GET') {
    const weekStart = cleanText(url.searchParams.get('weekStart'), 10);
    if (!isWeekStart(weekStart)) return json({ error: 'Choose a valid Monday for the week.' }, 400);
    return getWeeklyPlan(env.DB, weekStart);
  }
  if (url.pathname === '/api/weekly-plan/unlock' && request.method === 'POST') {
    const body = await readBody(request);
    const pinError = await checkFamilyPin(request, env, body.pin);
    return pinError ?? json({ unlocked: true });
  }
  if (url.pathname === '/api/weekly-plan' && request.method === 'PUT') {
    const body = await readBody(request);
    const weekStart = cleanText(body.weekStart, 10);
    if (!isWeekStart(weekStart) || !Array.isArray(body.meals) || body.meals.length > 21) {
      return json({ error: 'A valid week and up to 21 meal suggestions are required.' }, 400);
    }
    const existingPlan = await env.DB.prepare('SELECT week_start FROM weekly_plans WHERE week_start = ?').bind(weekStart).first();
    if (existingPlan) {
      const pinError = await checkFamilyPin(request, env, body.pin);
      if (pinError) return pinError;
    }
    const meals = body.meals.map((meal) => ({ recipeId: meal?.recipeId, type: meal?.type, eaten: meal?.eaten }));
    if (meals.some((meal) => typeof meal.recipeId !== 'string' || !meal.recipeId || !['dinner', 'lunch'].includes(meal.type) || (meal.eaten !== undefined && typeof meal.eaten !== 'boolean'))) {
      return json({ error: 'One or more recipe choices are invalid.' }, 400);
    }
    const selectedIds = [...new Set(meals.map((meal) => meal.recipeId))];
    if (selectedIds.length !== meals.length) return json({ error: 'A recipe can only appear once in the weekly bank.' }, 400);
    if (selectedIds.length) {
      const placeholders = selectedIds.map(() => '?').join(',');
      const { results } = await env.DB.prepare(`SELECT id, meal_kind FROM recipes WHERE id IN (${placeholders})`).bind(...selectedIds).all();
      if (results.length !== selectedIds.length) return json({ error: 'One or more selected recipes no longer exist.' }, 400);
      const mealKinds = new Map(results.map((recipe) => [recipe.id, recipe.meal_kind]));
      if (meals.some((meal) => meal.type !== mealKinds.get(meal.recipeId))) return json({ error: 'A recipe cannot be changed between lunch and dinner in the weekly bank.' }, 400);
    }
    const statements = [
      env.DB.prepare(`INSERT INTO weekly_plans (week_start, updated_at, shopping_list_id) VALUES (?, ?, NULL)
        ON CONFLICT(week_start) DO UPDATE SET updated_at = excluded.updated_at, shopping_list_id = NULL`)
        .bind(weekStart, Date.now()),
      env.DB.prepare('DELETE FROM weekly_plan_meals WHERE week_start = ?').bind(weekStart),
      ...meals.map((meal, position) => env.DB.prepare(
        'INSERT INTO weekly_plan_meals (week_start, position, recipe_id, meal_type, eaten) VALUES (?, ?, ?, ?, ?)',
      ).bind(weekStart, position, meal.recipeId, meal.type, Number(meal.eaten === true))),
    ];
    await env.DB.batch(statements);
    return getWeeklyPlan(env.DB, weekStart);
  }
  if (url.pathname === '/api/weekly-plan/meal' && request.method === 'PATCH') {
    const body = await readBody(request);
    const weekStart = cleanText(body.weekStart, 10);
    if (!isWeekStart(weekStart) || !Number.isInteger(body.position) || body.position < 0 || body.position > 20 || typeof body.eaten !== 'boolean') {
      return json({ error: 'Choose a valid planned meal and eaten state.' }, 400);
    }
    const meal = await env.DB.prepare('SELECT position FROM weekly_plan_meals WHERE week_start = ? AND position = ?').bind(weekStart, body.position).first();
    if (!meal) return json({ error: 'Planned meal not found.' }, 404);
    await env.DB.prepare('UPDATE weekly_plan_meals SET eaten = ? WHERE week_start = ? AND position = ?')
      .bind(Number(body.eaten), weekStart, body.position).run();
    return getWeeklyPlan(env.DB, weekStart);
  }
  if (url.pathname === '/api/weekly-plan/shopping-list' && request.method === 'POST') {
    const body = await readBody(request);
    const weekStart = cleanText(body.weekStart, 10);
    if (!isWeekStart(weekStart)) return json({ error: 'Choose a valid Monday for the week.' }, 400);
    return createWeeklyShoppingList(env.DB, weekStart, body.regenerate === true);
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
  if (listMatch && request.method === 'GET') return getShoppingList(env.DB, listMatch[1]);
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

  const pantryItemMatch = url.pathname.match(/^\/api\/pantry-items\/([\w-]+)$/);
  if (pantryItemMatch && request.method === 'PATCH') return updatePantryItem(request, env.DB, pantryItemMatch[1]);
  if (pantryItemMatch && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM pantry_items WHERE id = ?').bind(pantryItemMatch[1]).run();
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

function isWeekStart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

async function checkFamilyPin(request, env, candidate) {
  if (!env.FAMILY_PIN || !/^\d{8,12}$/.test(env.FAMILY_PIN)) {
    return json({ error: 'The family PIN has not been configured correctly.' }, 503);
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const now = Date.now();
  await env.DB.prepare('DELETE FROM pin_attempts WHERE window_started <= ?').bind(now - PIN_WINDOW_MS).run();
  const attempt = await env.DB.prepare('SELECT window_started, attempts FROM pin_attempts WHERE ip = ?').bind(ip).first();
  const inWindow = attempt && now - attempt.window_started < PIN_WINDOW_MS;
  if (inWindow && attempt.attempts >= PIN_ATTEMPT_LIMIT) {
    return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  }
  if (typeof candidate !== 'string' || !/^\d{8,12}$/.test(candidate) || !constantTimeEqual(candidate, env.FAMILY_PIN)) {
    const startedAt = inWindow ? attempt.window_started : now;
    await env.DB.prepare(`INSERT INTO pin_attempts (ip, window_started, attempts) VALUES (?, ?, 1)
      ON CONFLICT(ip) DO UPDATE SET window_started = excluded.window_started,
      attempts = CASE WHEN pin_attempts.window_started = excluded.window_started THEN pin_attempts.attempts + 1 ELSE 1 END`)
      .bind(ip, startedAt).run();
    return json({ error: 'That PIN is not correct.' }, 401);
  }
  await env.DB.prepare('DELETE FROM pin_attempts WHERE ip = ?').bind(ip).run();
  return null;
}

async function getWeeklyPlan(db, weekStart) {
  const { results } = await db.prepare(`SELECT m.position, m.recipe_id, m.meal_type, m.eaten, r.title AS recipe_title
    FROM weekly_plan_meals m LEFT JOIN recipes r ON r.id = m.recipe_id
    WHERE m.week_start = ? ORDER BY m.position`).bind(weekStart).all();
  const saved = await db.prepare('SELECT updated_at, shopping_list_id FROM weekly_plans WHERE week_start = ?')
    .bind(weekStart).first();
  return json({
    weekStart,
    updatedAt: saved?.updated_at ?? null,
    shoppingListId: saved?.shopping_list_id ?? null,
    meals: results.filter((meal) => meal.recipe_title).map((meal) => ({ day: meal.position, recipeId: meal.recipe_id, recipeTitle: meal.recipe_title, type: meal.meal_type, eaten: Boolean(meal.eaten) })),
  });
}

function normalizeIngredientText(value) {
  return String(value ?? '').toLocaleLowerCase('sv').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' och ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function ingredientKey(name) {
  const preparationWords = new Set([
    'hackad', 'hackade', 'finhackad', 'finhackade', 'skivad', 'skivade',
    'strimlad', 'strimlade', 'tarnad', 'tarnade', 'riven', 'grovriven',
    'pressad', 'pressade', 'skalad', 'skalade', 'farsk', 'farska', 'tinad',
  ]);
  const aliases = new Map([
    ['tomater', 'tomat'], ['tomaterna', 'tomat'], ['morotter', 'morot'],
    ['paprikor', 'paprika'], ['bananer', 'banan'], ['citroner', 'citron'],
    ['apelsiner', 'apelsin'], ['applen', 'apple'], ['champinjoner', 'champinjon'],
    ['gurkor', 'gurka'], ['potatisar', 'potatis'],
  ]);
  const words = normalizeIngredientText(name).split(' ')
    .filter((word) => !preparationWords.has(word))
    .map((word) => aliases.get(word) ?? word);
  return words.join(' ') || normalizeIngredientText(name);
}

const UNIT_ALIASES = new Map([
  ['g', 'g'], ['gr', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['kg', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['hg', 'hg'], ['hektogram', 'hg'], ['mg', 'mg'], ['milligram', 'mg'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['millilitre', 'ml'],
  ['cl', 'cl'], ['centiliter', 'cl'], ['centilitre', 'cl'],
  ['dl', 'dl'], ['deciliter', 'dl'], ['decilitre', 'dl'],
  ['l', 'l'], ['liter', 'l'], ['litre', 'l'], ['liters', 'l'], ['litres', 'l'],
  ['tsk', 'tsk'], ['tesk', 'tsk'], ['tesked', 'tsk'], ['teskedar', 'tsk'], ['tsp', 'tsk'], ['teaspoon', 'tsk'],
  ['msk', 'msk'], ['matsked', 'msk'], ['matskedar', 'msk'], ['tbsp', 'msk'], ['tablespoon', 'msk'],
  ['krm', 'krm'], ['kryddmatt', 'krm'],
  ['st', 'st'], ['stk', 'st'], ['styck', 'st'], ['stycken', 'st'], ['piece', 'st'], ['pieces', 'st'],
  ['klyfta', 'klyfta'], ['klyftor', 'klyfta'], ['clove', 'klyfta'], ['cloves', 'klyfta'],
  ['burk', 'burk'], ['burkar', 'burk'], ['can', 'burk'], ['cans', 'burk'],
  ['paket', 'paket'], ['pack', 'paket'], ['package', 'paket'], ['packages', 'paket'],
  ['forpackning', 'forpackning'], ['forpackningar', 'forpackning'],
  ['pase', 'pase'], ['pasar', 'pase'], ['bag', 'pase'], ['bags', 'pase'],
  ['nypa', 'nypa'], ['nypor', 'nypa'], ['pinch', 'nypa'],
  ['kvist', 'kvist'], ['kvistar', 'kvist'], ['sprig', 'kvist'],
  ['kruka', 'kruka'], ['krukor', 'kruka'],
  ['skiva', 'skiva'], ['skivor', 'skiva'],
  ['portion', 'portion'], ['portioner', 'portion'],
]);

function normalizeUnit(unit) {
  const key = normalizeIngredientText(unit).replace(/\.$/, '');
  return UNIT_ALIASES.get(key) ?? key;
}

function unitDefinition(unit) {
  const definitions = {
    g: ['mass', 1], mg: ['mass', 0.001], hg: ['mass', 100], kg: ['mass', 1000],
    ml: ['volume', 1], cl: ['volume', 10], dl: ['volume', 100], l: ['volume', 1000],
    krm: ['volume', 1], tsk: ['volume', 5], msk: ['volume', 15],
    st: ['count:st', 1], klyfta: ['count:klyfta', 1], burk: ['count:burk', 1],
    paket: ['count:paket', 1], forpackning: ['count:forpackning', 1],
    pase: ['count:pase', 1], nypa: ['count:nypa', 1], kvist: ['count:kvist', 1],
    kruka: ['count:kruka', 1], skiva: ['count:skiva', 1], portion: ['count:portion', 1],
  };
  return definitions[unit] ?? null;
}

function parseQuantity(value) {
  const natural = normalizeIngredientText(value);
  if (natural === 'en halv' || natural === 'ett halvt' || natural === 'half') return 0.5;
  if (natural === 'en kvart' || natural === 'ett fjardedels' || natural === 'quarter') return 0.25;
  let text = String(value ?? '').toLocaleLowerCase('sv');
  const unicodeFractions = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4' };
  for (const [symbol, fraction] of Object.entries(unicodeFractions)) text = text.replaceAll(symbol, ` ${fraction}`);
  text = text.replace(/,/g, '.').trim().replace(/\s+/g, ' ');
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed && Number(mixed[3]) > 0) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return null;
}

function formatQuantity(value) {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
}

function formatCountUnit(unit, quantity) {
  if (quantity === 1) return unit;
  return ({
    klyfta: 'klyftor', burk: 'burkar', paket: 'paket', forpackning: 'förpackningar',
    pase: 'påsar', nypa: 'nypor', kvist: 'kvistar', kruka: 'krukor',
    skiva: 'skivor', portion: 'portioner',
  })[unit] ?? unit;
}

function convertQuantity(total, dimension, sourceUnits) {
  if (dimension === 'mass') {
    if (total >= 1500) return { amount: formatQuantity(total / 1000), unit: 'kg' };
    return { amount: formatQuantity(total), unit: 'g' };
  }
  if (dimension === 'volume') {
    if (total >= 1000) return { amount: formatQuantity(total / 1000), unit: 'l' };
    if (total >= 100) return { amount: formatQuantity(total / 100), unit: 'dl' };
    if (sourceUnits.every((unit) => unit === 'tsk')) return { amount: formatQuantity(total / 5), unit: 'tsk' };
    if (sourceUnits.every((unit) => unit === 'krm')) return { amount: formatQuantity(total), unit: 'krm' };
    if (sourceUnits.every((unit) => unit === 'msk')) return { amount: formatQuantity(total / 15), unit: 'msk' };
    if (total >= 15 && sourceUnits.every((unit) => unit === 'msk' || unit === 'tsk' || unit === 'krm')) {
      return { amount: formatQuantity(total / 15), unit: 'msk' };
    }
    return { amount: formatQuantity(total), unit: 'ml' };
  }
  const unit = sourceUnits[0];
  return { amount: formatQuantity(total), unit: formatCountUnit(unit, total) };
}

function aggregateAmount(rows) {
  if (rows.length === 1) return { amount: rows[0].amount, unit: rows[0].unit };
  const values = rows.map((row) => {
    let amount = cleanText(row.amount, 40);
    let unit = cleanText(row.unit, 40);
    if (!unit) {
      const embeddedUnit = amount.match(/^(.+?)\s+([^\s]+)$/);
      if (embeddedUnit && unitDefinition(normalizeUnit(embeddedUnit[2]))) {
        amount = embeddedUnit[1];
        unit = embeddedUnit[2];
      }
    }
    return { amount, unit, quantity: parseQuantity(amount), normalizedUnit: normalizeUnit(unit) };
  });
  const seenUnparsed = new Set();
  const uniqueValues = values.filter((row) => {
    if (row.quantity !== null) return true;
    const key = `${normalizeIngredientText(row.amount)}|${row.normalizedUnit}`;
    if (seenUnparsed.has(key)) return false;
    seenUnparsed.add(key);
    return true;
  });
  if (uniqueValues.length === 1 && !uniqueValues[0].amount && !uniqueValues[0].unit) return { amount: '', unit: '' };

  const definitions = uniqueValues.map((row) => unitDefinition(row.normalizedUnit));
  const dimension = definitions[0]?.[0] ?? (uniqueValues[0].normalizedUnit ? null : 'number');
  const compatible = uniqueValues.every((row, index) => row.quantity !== null && (definitions[index]?.[0] ?? (row.normalizedUnit ? null : 'number')) === dimension);
  if (compatible && dimension) {
    if (dimension === 'number') {
      return { amount: formatQuantity(uniqueValues.reduce((sum, row) => sum + row.quantity, 0)), unit: '' };
    }
    const total = uniqueValues.reduce((sum, row, index) => sum + row.quantity * definitions[index][1], 0);
    return convertQuantity(total, dimension, uniqueValues.map((row) => row.normalizedUnit));
  }

  const parts = uniqueValues.map((row) => {
    if (row.amount && row.unit) return `${row.amount} ${row.unit}`;
    if (row.amount) return row.amount;
    if (row.unit) return row.unit;
    return 'ospecificerad mängd';
  });
  return { amount: parts.join(' + '), unit: '' };
}

function aggregateIngredients(ingredients) {
  const groups = new Map();
  for (const ingredient of ingredients) {
    const key = ingredientKey(ingredient.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ingredient);
  }
  return [...groups.entries()].map(([, rows]) => {
    const amount = aggregateAmount(rows);
    return { name: rows[0].name.trim(), amount: amount.amount, unit: amount.unit, sectionCode: rows.find((row) => row.sectionCode)?.sectionCode ?? '' };
  }).sort((left, right) => left.name.localeCompare(right.name, 'sv'));
}

async function createWeeklyShoppingList(db, weekStart, regenerate = false) {
  const plan = await db.prepare('SELECT shopping_list_id FROM weekly_plans WHERE week_start = ?')
    .bind(weekStart).first();
  if (!plan) return json({ error: 'Save the dinner plan before making its shopping list.' }, 400);
  if (plan.shopping_list_id && !regenerate) {
    const existing = await getShoppingListData(db, plan.shopping_list_id);
    if (existing) return json(existing);
  }
  const selected = await db.prepare(`SELECT recipe_id FROM weekly_plan_meals
    WHERE week_start = ? AND recipe_id IS NOT NULL ORDER BY position`).bind(weekStart).all();
  if (!selected.results.length) return json({ error: 'Choose at least one dinner before making a shopping list.' }, 400);
  const ingredientCount = await db.prepare(`SELECT COUNT(*) AS count FROM weekly_plan_meals m
    JOIN recipe_ingredients ri ON ri.recipe_id = m.recipe_id
    WHERE m.week_start = ? AND m.recipe_id IS NOT NULL`).bind(weekStart).first();
  if (!ingredientCount?.count) return json({ error: 'The selected recipes do not have any ingredients yet.' }, 400);

  const ingredients = await getWeeklyIngredients(db, weekStart);
  const pantryItems = await getPantryItems(db);
  const generatedIngredients = [...ingredients];
  for (const pantryItem of pantryItems) {
    const key = ingredientKey(pantryItem.name);
    const existing = generatedIngredients.filter((item) => ingredientKey(item.name) === key);
    if (existing.length && !pantryItem.amount && !pantryItem.unit) {
      for (const item of existing) if (!item.sectionCode) item.sectionCode = pantryItem.sectionCode;
      continue;
    }
    generatedIngredients.push(pantryItem);
  }
  const aggregatedIngredients = aggregateIngredients(generatedIngredients);
  const previousChecks = new Map();
  if (plan.shopping_list_id && regenerate) {
    const existing = await getShoppingListData(db, plan.shopping_list_id);
    for (const item of existing?.items ?? []) previousChecks.set(ingredientKey(item.name), item.checked);
  }
  const id = plan.shopping_list_id && regenerate ? plan.shopping_list_id : crypto.randomUUID();
  const now = Date.now();
  const title = `Inköpslista vecka ${weekNumber(weekStart)}`;
  const statements = [];
  if (plan.shopping_list_id && regenerate) {
    statements.push(db.prepare('DELETE FROM shopping_list_items WHERE list_id = ?').bind(id));
    statements.push(db.prepare('UPDATE shopping_lists SET title = ?, updated_at = ? WHERE id = ?').bind(title, now, id));
  } else {
    statements.push(db.prepare('INSERT INTO shopping_lists (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(id, title, now, now));
  }
  statements.push(
    ...aggregatedIngredients.map((ingredient, position) => db.prepare(`INSERT INTO shopping_list_items
      (id, list_id, name, amount, unit, checked, recipe_id, position, section_code)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), id, ingredient.name, ingredient.amount, ingredient.unit, Number(previousChecks.get(ingredientKey(ingredient.name)) ?? false), position, ingredient.sectionCode)),
    db.prepare('UPDATE weekly_plans SET shopping_list_id = ?, updated_at = ? WHERE week_start = ?')
      .bind(id, now, weekStart),
  );
  await db.batch(statements);
  return json(await getShoppingListData(db, id), plan.shopping_list_id && regenerate ? 200 : 201);
}

function weekNumber(weekStart) {
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + ((4 - firstThursday.getUTCDay() + 7) % 7));
  return 1 + Math.round((date - firstThursday) / (7 * 86400000));
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
    sectionCode: cleanText(item?.sectionCode, 4).toUpperCase().match(/^[A-Z]$/)?.[0] ?? '',
    position: index,
  }));
  const steps = body.steps.map((item, index) => ({
    instruction: cleanText(typeof item === 'string' ? item : item?.instruction, 4000),
    position: index,
  }));
  if (ingredients.some((item) => !item.name) || steps.some((item) => !item.instruction)) return null;
  const allowedTypes = new Set(['meat', 'chicken', 'fish', 'vegetarian', 'vegan', 'other']);
  const allowedDifficulties = new Set(['easy', 'medium', 'hard']);
  const intOrNull = (value) => Number.isInteger(value) && value >= 0 && value <= 1440 ? value : null;
  return {
    title,
    description: cleanText(body.description, 2000),
    prepMinutes: intOrNull(body.prepMinutes),
    cookMinutes: intOrNull(body.cookMinutes),
    servings: Number.isInteger(body.servings) && body.servings > 0 && body.servings <= 100 ? body.servings : null,
    foodType: allowedTypes.has(body.foodType) ? body.foodType : 'other',
    mealKind: body.mealKind === 'lunch' ? 'lunch' : 'dinner',
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
  const enrichedIngredients = await applyRememberedSections(db, ingredientRows.results);
  return json(recipes.map((recipe) => toRecipe(recipe, enrichedIngredients, stepRows.results)));
}

async function getRecipe(db, id) {
  const recipe = await db.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first();
  if (!recipe) return json({ error: 'Recipe not found.' }, 404);
  const [ingredients, steps] = await Promise.all([
    db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position').bind(id).all(),
    db.prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY position').bind(id).all(),
  ]);
  return json(toRecipe(recipe, await applyRememberedSections(db, ingredients.results), steps.results));
}

async function saveRecipe(db, recipe, existingId = null) {
  const id = existingId ?? crypto.randomUUID();
  const now = Date.now();
  const existing = existingId ? await db.prepare('SELECT created_at FROM recipes WHERE id = ?').bind(existingId).first() : null;
  if (existingId && !existing) return json({ error: 'Recipe not found.' }, 404);
  const statements = [db.prepare(`INSERT INTO recipes
    (id, title, description, prep_minutes, cook_minutes, servings, food_type, food_category, meal_kind, difficulty, favorite, kid_friendly, confirmed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
    prep_minutes=excluded.prep_minutes, cook_minutes=excluded.cook_minutes, servings=excluded.servings,
    food_type=excluded.food_type, food_category=excluded.food_category, meal_kind=excluded.meal_kind, difficulty=excluded.difficulty, favorite=excluded.favorite,
    kid_friendly=excluded.kid_friendly, confirmed=0, updated_at=excluded.updated_at`)
    .bind(id, recipe.title, recipe.description, recipe.prepMinutes, recipe.cookMinutes, recipe.servings,
      recipe.foodType === 'chicken' ? 'meat' : recipe.foodType, recipe.foodType, recipe.mealKind, recipe.difficulty, Number(recipe.favorite), Number(recipe.kidFriendly), existing?.created_at ?? now, now)];
  if (existingId) {
    statements.push(db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').bind(id));
    statements.push(db.prepare('UPDATE weekly_plan_meals SET meal_type = ? WHERE recipe_id = ?').bind(recipe.mealKind, id));
  }
  const ingredientRows = recipe.ingredients.map((ingredient) => ({ ...ingredient, id: crypto.randomUUID() }));
  const stepRows = recipe.steps.map((step) => ({ ...step, id: crypto.randomUUID() }));
  for (const ingredient of ingredientRows) {
    statements.push(db.prepare(`INSERT INTO recipe_ingredients (id, recipe_id, name, amount, unit, position, section_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(ingredient.id, id, ingredient.name, ingredient.amount, ingredient.unit, ingredient.position, ingredient.sectionCode));
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
    mealKind: recipe.mealKind,
    difficulty: recipe.difficulty,
    favorite: recipe.favorite,
    kidFriendly: recipe.kidFriendly,
    confirmed: false,
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

async function getShoppingList(db, id) {
  let list = await getShoppingListData(db, id);
  if (list && await refreshDuplicateWeeklyItems(db, id, list)) list = await getShoppingListData(db, id);
  return list ? json(list) : json({ error: 'Shopping list not found.' }, 404);
}

async function getShoppingListData(db, id) {
  const list = await db.prepare('SELECT * FROM shopping_lists WHERE id = ?').bind(id).first();
  if (!list) return null;
  const { results: items } = await db.prepare('SELECT * FROM shopping_list_items WHERE list_id = ? ORDER BY position')
    .bind(id).all();
  return {
    id: list.id,
    title: list.title,
    createdAt: list.created_at,
    updatedAt: list.updated_at,
    items: items.map(toShoppingItem),
    sections: await getStoreSections(db),
  };
}

async function getStoreSections(db) {
  const { results } = await db.prepare('SELECT code, name, position FROM store_sections ORDER BY position, code').all();
  return results;
}
async function listStoreSections(db) { return json(await getStoreSections(db)); }

async function getPantryItems(db) {
  const { results } = await db.prepare('SELECT id, name, amount, unit, section_code AS sectionCode, position FROM pantry_items ORDER BY position, name').all();
  return results;
}

async function listPantryItems(db) { return json(await getPantryItems(db)); }

function cleanPantryItem(body) {
  const name = cleanText(body?.name, 160);
  const amount = cleanText(body?.amount, 40);
  const unit = cleanText(body?.unit, 40);
  const sectionCode = cleanText(body?.sectionCode, 4).toUpperCase();
  if (!name) return { error: 'Enter an item name.' };
  if (sectionCode && !/^[A-Z]$/.test(sectionCode)) return { error: 'Choose a valid store section.' };
  return { name, amount, unit, sectionCode };
}

async function addPantryItem(request, db) {
  const body = await readBody(request);
  const item = cleanPantryItem(body);
  if (item.error) return json({ error: item.error }, 400);
  if (item.sectionCode && !(await db.prepare('SELECT code FROM store_sections WHERE code = ?').bind(item.sectionCode).first())) {
    return json({ error: 'Choose an existing store section.' }, 400);
  }
  const id = crypto.randomUUID();
  const { maxPosition } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM pantry_items').first();
  await db.prepare('INSERT INTO pantry_items (id, name, amount, unit, section_code, position) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, item.name, item.amount, item.unit, item.sectionCode, maxPosition + 1).run();
  return json({ id, ...item, position: maxPosition + 1 }, 201);
}

async function updatePantryItem(request, db, id) {
  const current = await db.prepare('SELECT * FROM pantry_items WHERE id = ?').bind(id).first();
  if (!current) return json({ error: 'Pantry item not found.' }, 404);
  const body = await readBody(request);
  const item = cleanPantryItem({
    name: body.name === undefined ? current.name : body.name,
    amount: body.amount === undefined ? current.amount : body.amount,
    unit: body.unit === undefined ? current.unit : body.unit,
    sectionCode: body.sectionCode === undefined ? current.section_code : body.sectionCode,
  });
  if (item.error) return json({ error: item.error }, 400);
  if (item.sectionCode && !(await db.prepare('SELECT code FROM store_sections WHERE code = ?').bind(item.sectionCode).first())) {
    return json({ error: 'Choose an existing store section.' }, 400);
  }
  await db.prepare('UPDATE pantry_items SET name = ?, amount = ?, unit = ?, section_code = ? WHERE id = ?')
    .bind(item.name, item.amount, item.unit, item.sectionCode, id).run();
  return json({ id, ...item, position: current.position });
}

async function loadIngredientSectionMemory(db) {
  const memory = new Map();
  const [saved, recipeRows, listRows, pantryRows] = await Promise.all([
    db.prepare('SELECT ingredient_key, section_code FROM ingredient_section_memory').all(),
    db.prepare("SELECT name, section_code FROM recipe_ingredients WHERE section_code != ''").all(),
    db.prepare(`SELECT i.name, i.section_code FROM shopping_list_items i JOIN shopping_lists l ON l.id = i.list_id
      WHERE i.section_code != '' ORDER BY l.updated_at DESC`).all(),
    db.prepare("SELECT name, section_code FROM pantry_items WHERE section_code != '' ORDER BY position").all(),
  ]);
  for (const row of saved.results) memory.set(row.ingredient_key, row.section_code);
  for (const row of [...listRows.results, ...pantryRows.results, ...recipeRows.results]) {
    const key = ingredientKey(row.name);
    if (key && !memory.has(key)) memory.set(key, row.section_code);
  }
  return memory;
}

async function applyRememberedSections(db, ingredients) {
  const memory = await loadIngredientSectionMemory(db);
  return ingredients.map((ingredient) => ingredient.section_code
    ? ingredient
    : { ...ingredient, section_code: memory.get(ingredientKey(ingredient.name)) ?? '' });
}

async function resolveRecipeSections(db, ingredients) {
  const memory = await loadIngredientSectionMemory(db);
  const updates = [];
  for (const ingredient of ingredients) {
    const key = ingredientKey(ingredient.name);
    if (ingredient.sectionCode) memory.set(key, ingredient.sectionCode);
    else ingredient.sectionCode = memory.get(key) ?? '';
    if (ingredient.sectionCode) updates.push(db.prepare(`INSERT INTO ingredient_section_memory (ingredient_key, section_code, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(ingredient_key) DO UPDATE SET section_code = excluded.section_code, updated_at = excluded.updated_at`)
      .bind(key, ingredient.sectionCode, Date.now()));
  }
  if (updates.length) await db.batch(updates);
}

async function refreshDuplicateWeeklyItems(db, listId, list) {
  if (!list.items.length || list.items.some((item) => !item.recipeId)) return false;
  const plan = await db.prepare('SELECT week_start FROM weekly_plans WHERE shopping_list_id = ?').bind(listId).first();
  if (!plan) return false;
  const source = await getWeeklyIngredients(db, plan.week_start);
  const aggregate = aggregateIngredients(source);
  if (aggregate.length >= list.items.length) return false;

  const previousChecks = new Map();
  for (const item of list.items) {
    const key = ingredientKey(item.name);
    previousChecks.set(key, [...(previousChecks.get(key) ?? []), item.checked]);
  }
  const statements = [db.prepare('DELETE FROM shopping_list_items WHERE list_id = ?').bind(listId)];
  aggregate.forEach((ingredient, position) => {
    const checkedValues = previousChecks.get(ingredientKey(ingredient.name)) ?? [];
    const checked = checkedValues.length > 0 && checkedValues.every(Boolean);
    statements.push(db.prepare(`INSERT INTO shopping_list_items
      (id, list_id, name, amount, unit, checked, recipe_id, position, section_code)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), listId, ingredient.name, ingredient.amount, ingredient.unit, Number(checked), position, ingredient.sectionCode));
  });
  statements.push(db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), listId));
  await db.batch(statements);
  return true;
}

async function getWeeklyIngredients(db, weekStart) {
  const { results } = await db.prepare(`SELECT ri.name, ri.amount, ri.unit, ri.section_code AS sectionCode
    FROM weekly_plan_meals m JOIN recipe_ingredients ri ON ri.recipe_id = m.recipe_id
    WHERE m.week_start = ? AND m.recipe_id IS NOT NULL ORDER BY m.position, ri.position`)
    .bind(weekStart).all();
  const memory = await loadIngredientSectionMemory(db);
  return results.map((ingredient) => ({ ...ingredient, sectionCode: ingredient.sectionCode || memory.get(ingredientKey(ingredient.name)) || '' }));
}

async function addShoppingItem(request, db, listId) {
  const list = await db.prepare('SELECT id FROM shopping_lists WHERE id = ?').bind(listId).first();
  if (!list) return json({ error: 'Shopping list not found.' }, 404);
  const body = await readBody(request);
  const name = cleanText(body.name, 160);
  if (!name) return json({ error: 'Enter an item name.' }, 400);
  const memory = await loadIngredientSectionMemory(db);
  const sectionCode = memory.get(ingredientKey(name)) ?? '';
  const id = crypto.randomUUID();
  const { maxPosition } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM shopping_list_items WHERE list_id = ?')
    .bind(listId).first();
  await db.batch([
    db.prepare(`INSERT INTO shopping_list_items (id, list_id, name, amount, unit, checked, recipe_id, position, section_code)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
      .bind(id, listId, name, cleanText(body.amount, 40), cleanText(body.unit, 40), maxPosition + 1, sectionCode),
    db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), listId),
  ]);
  return json({ id, name, amount: cleanText(body.amount, 40), unit: cleanText(body.unit, 40), checked: false, sectionCode }, 201);
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
  const memory = await loadIngredientSectionMemory(db);
  const { maxPosition } = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPosition FROM shopping_list_items WHERE list_id = ?')
    .bind(listId).first();
  const statements = ingredients.map((item, index) => db.prepare(`INSERT INTO shopping_list_items
    (id, list_id, name, amount, unit, checked, recipe_id, position, section_code) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .bind(crypto.randomUUID(), listId, item.name, item.amount, item.unit, item.recipe_id, maxPosition + index + 1, item.section_code || memory.get(ingredientKey(item.name)) || ''));
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
  const sectionCode = body.sectionCode === undefined ? current.section_code : cleanText(body.sectionCode, 4).toUpperCase().match(/^[A-Z]$/)?.[0] ?? '';
  const memoryUpdate = sectionCode ? [db.prepare(`INSERT INTO ingredient_section_memory (ingredient_key, section_code, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(ingredient_key) DO UPDATE SET section_code = excluded.section_code, updated_at = excluded.updated_at`)
    .bind(ingredientKey(name), sectionCode, Date.now())] : [];
  await db.batch([
    db.prepare('UPDATE shopping_list_items SET name = ?, amount = ?, unit = ?, checked = ?, section_code = ? WHERE id = ?')
      .bind(name, amount, unit, checked, sectionCode, itemId),
    db.prepare('UPDATE shopping_lists SET updated_at = ? WHERE id = ?').bind(Date.now(), current.list_id),
    ...memoryUpdate,
  ]);
  return json(toShoppingItem({ ...current, name, amount, unit, checked, section_code: sectionCode }));
}

function toRecipe(recipe, ingredients, steps) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    prepMinutes: recipe.prep_minutes,
    cookMinutes: recipe.cook_minutes,
    servings: recipe.servings,
    foodType: recipe.food_category ?? recipe.food_type,
    mealKind: recipe.meal_kind ?? 'dinner',
    difficulty: recipe.difficulty,
    favorite: Boolean(recipe.favorite),
    kidFriendly: Boolean(recipe.kid_friendly),
    confirmed: Boolean(recipe.confirmed),
    ingredients: ingredients.filter((item) => item.recipe_id === recipe.id).map((item) => ({
      id: item.id, name: item.name, amount: item.amount, unit: item.unit, position: item.position, sectionCode: item.section_code ?? '',
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
    sectionCode: item.section_code ?? '',
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
