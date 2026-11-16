const COOP_STORE = { id: 'coop-lund', retailer: 'Coop', name: 'Stora Coop Lund', city: 'Lund' };
const STORE_PAGE_URL = 'https://www.coop.se/butiker-erbjudanden/stora-coop/stora-coop-lund/';
const CATEGORIES = new Map([
  ['Bröd & bageri', 'Bröd & bageri'],
  ['Deli & chark', 'Kött & chark'],
  ['Frukt & grönt', 'Frukt & grönt'],
  ['Frysvaror', 'Fryst'],
  ['Fågel, fisk & kött', null],
  ['Godis & snacks', 'Godis & snacks'],
  ['Hem & fritid', 'Övrigt'],
  ['Kaffe & dryck', 'Dryck'],
  ['Mejeri & ägg', 'Mejeri & ost'],
  ['Skafferi', 'Skafferi'],
]);

const OFFER_CATEGORIES = new Set([
  'Bröd & bageri',
  'Kött & chark',
  'Fisk & skaldjur',
  'Frukt & grönt',
  'Fryst',
  'Dryck',
  'Mejeri & ost',
  'Skafferi',
  'Godis & snacks',
  'Övrigt',
]);

export function getIsoWeekRange(weekCode) {
  const match = typeof weekCode === 'string' && weekCode.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('Ogiltigt veckonummer för reklambladet.');

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) throw new Error('Ogiltigt veckonummer för reklambladet.');

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  if (getIsoWeekCode(monday) !== weekCode)
    throw new Error('Ogiltigt veckonummer för reklambladet.');

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

export function getCurrentCoopWeekCode(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return getIsoWeekCode(
    new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))),
  );
}

export function parseCoopOfferCard({ productName, sourceCategory, text }, index, weekCode) {
  if (
    typeof productName !== 'string' ||
    productName.trim().length < 2 ||
    productName.length > 160
  ) {
    throw new Error('Ett Coop-erbjudande saknar ett giltigt produktnamn.');
  }
  if (
    typeof text !== 'string' ||
    text.length < productName.length ||
    text.length > 3_000 ||
    !text.startsWith(productName.trim())
  ) {
    throw new Error(`Källtexten för "${productName}" är ogiltig.`);
  }

  const category = mapCoopCategory(sourceCategory, productName, text);
  const validityPeriod = { status: 'known', value: getIsoWeekRange(weekCode) };
  const conditions = parseConditions(text);
  const offerPrice = parseOfferPrice(text);
  if (offerPrice.status === 'uncertain') {
    throw new Error(`Kunde inte läsa priset för "${productName}" säkert.`);
  }

  const brand = parseBrand(text);
  const packageSize = parsePackageSize(text);
  const unitPrice = parseUnitPrice(text);
  const regularPrice = parseRegularPrice(text);
  const hasUncertainField = [
    brand,
    category,
    offerPrice,
    packageSize,
    unitPrice,
    regularPrice,
  ].some((field) => field.status === 'uncertain');
  return {
    id: `coop-${weekCode}-${index + 1}`,
    flyerId: `coop-lund-${weekCode}`,
    productName: { status: 'known', value: productName.trim() },
    brand,
    category,
    offerPrice,
    regularPrice,
    packageSize,
    unitPrice,
    validityPeriod,
    conditions: { status: 'known', value: conditions },
    sourcePage: { status: 'missing' },
    extractionConfidence: hasUncertainField ? 'medium' : 'high',
  };
}

export function normalizeAutomatedOfferPayload(value, now = new Date()) {
  if (
    !value ||
    value.storeId !== COOP_STORE.id ||
    value.storeName !== COOP_STORE.name ||
    value.storePageUrl !== STORE_PAGE_URL
  ) {
    throw new Error('Automatimporten bekräftade inte att källan är Stora Coop Lund.');
  }

  const currentWeek = getCurrentCoopWeekCode(now);
  if (value.weekCode !== currentWeek) {
    throw new Error('Coops reklambladslänk gäller inte innevarande vecka. Inget publicerades.');
  }
  const validityPeriod = normalizeFlyerValidityPeriod(
    value.pdfEvidence.validityPeriod,
    value.weekCode,
  );
  const flyerUrl = validateFlyerUrl(value.flyerUrl, value.weekCode);
  validatePdfEvidence(value.pdfEvidence, value.weekCode);

  if (
    !Array.isArray(value.categoryCounts) ||
    !Array.isArray(value.cards) ||
    !Number.isInteger(value.expectedOfferCount) ||
    value.expectedOfferCount < 20 ||
    value.expectedOfferCount > 200 ||
    value.cards.length !== value.expectedOfferCount
  ) {
    throw new Error('Coops erbjudandelista verkar ofullständig. Inget publicerades.');
  }

  const counts = new Map();
  for (const entry of value.categoryCounts) {
    if (
      !entry ||
      !CATEGORIES.has(entry.name) ||
      !Number.isInteger(entry.count) ||
      entry.count < 0 ||
      counts.has(entry.name)
    ) {
      throw new Error('Coops avdelningslista har ändrats eller är ogiltig. Inget publicerades.');
    }
    counts.set(entry.name, entry.count);
  }
  if (
    counts.size !== CATEGORIES.size ||
    [...counts.values()].reduce((total, count) => total + count, 0) !== value.expectedOfferCount
  ) {
    throw new Error('Avdelningsantalet stämmer inte med Coops totala erbjudandelista.');
  }

  const scrapedCounts = new Map([...counts.keys()].map((category) => [category, 0]));
  const cardIdentities = new Set();
  const offers = value.cards.map((card, index) => {
    if (!card || !counts.has(card.sourceCategory)) {
      throw new Error('Ett Coop-erbjudande saknar en giltig avdelning.');
    }
    const identity = `${card.sourceCategory}\u0000${card.productName?.trim().toLocaleLowerCase('sv-SE')}\u0000${card.text?.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv-SE')}`;
    if (cardIdentities.has(identity))
      throw new Error('Coops erbjudandelista innehåller dubbla produkter.');
    cardIdentities.add(identity);
    scrapedCounts.set(card.sourceCategory, scrapedCounts.get(card.sourceCategory) + 1);
    const offer = parseCoopOfferCard(card, index, value.weekCode);
    offer.validityPeriod = { status: 'known', value: validityPeriod };
    return offer;
  });
  for (const [category, expected] of counts) {
    if (scrapedCounts.get(category) !== expected) {
      throw new Error(`Antalet erbjudanden i avdelningen "${category}" stämmer inte.`);
    }
  }
  if (new Set(offers.map((offer) => offer.id)).size !== offers.length) {
    throw new Error('Coops erbjudandelista innehåller dubbla poster.');
  }

  const flyerId = `coop-lund-${value.weekCode}`;
  for (const offer of offers) offer.flyerId = flyerId;

  return {
    weekCode: value.weekCode,
    flyerUrl,
    offers,
    catalog: {
      stores: [COOP_STORE],
      flyers: [
        {
          id: flyerId,
          storeId: COOP_STORE.id,
          sourceUrl: flyerUrl,
          validityPeriod: { status: 'known', value: validityPeriod },
          sourceNote:
            'Erbjudandena hämtas från Coops butikssida. PDF:en har kontrollerats för butik och datum, men alla PDF-erbjudanden har inte jämförts med butikssidan.',
        },
      ],
      offers,
    },
  };
}

export function hasValidAutomationToken(request, expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length < 32) return false;
  const authorization = request.headers.get('Authorization') ?? '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  if (!match) return false;

  const left = new TextEncoder().encode(match[1]);
  const right = new TextEncoder().encode(expectedToken);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function mapCoopCategory(sourceCategory, productName, text) {
  if (!CATEGORIES.has(sourceCategory))
    throw new Error('Okänd avdelning från Coops erbjudandesida.');
  const mapped = CATEGORIES.get(sourceCategory);
  if (mapped) return { status: 'known', value: mapped };
  const description = `${productName} ${text}`;
  const isFish = /fisk|räk|skaldjur|torsk|lax|fish|crisp/i.test(description);
  const isMeat =
    /kyckling|fågel|kött|bacon|fläsk|nöt|lamm|färs|korv|chark|skinka|kotlett|stek|burgare|entrecôte|revben|spjäll|rostbiff|biff|köttbull|salami/i.test(
      description,
    );
  if (isFish !== isMeat) {
    return { status: 'known', value: isFish ? 'Fisk & skaldjur' : 'Kött & chark' };
  }
  return {
    status: 'uncertain',
    value: null,
    note: 'Coops avdelning innehåller både kött och fisk, och produkten kan inte placeras säkert.',
  };
}

function parseOfferPrice(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/(?:jfr-pris|jämförpris).*$/i, '').trim())
    .filter(Boolean);
  for (const line of lines) {
    const multiBuy = line.match(/(\d+)\s+för\s+([\d ]+(?:[,.]\d{1,2})?)\s*(?:kronor|kr)\b/i);
    if (multiBuy) return knownPrice(parseSwedishAmount(multiBuy[2]));

    const amount = line.match(
      /([\d ]+(?:[,.]\d{1,2})?)\s*(?:kronor|kr)(?:\s+och\s+(\d{1,2})\s+öre)?\b/i,
    );
    if (amount) {
      const wholeAmount = parseSwedishAmount(amount[1]);
      const value = wholeAmount + (amount[2] ? Number(amount[2]) / 100 : 0);
      return knownPrice(value);
    }

    const shortPrice = line.match(/(?:^|\s)(\d{1,4}(?:[,.]\d{1,2})?)\s*:-?(?:\s|$)/);
    if (shortPrice) return knownPrice(parseSwedishAmount(shortPrice[1]));
  }

  const displayedPrice = lines
    .join('\n')
    .match(/(?:^|\n)\s*(\d{1,4}(?:[,.]\d{1,2})?)\s*\n?\s*kr(?:\/(?:st|kg|l|liter))?/i);
  if (displayedPrice) return knownPrice(Number(displayedPrice[1].replace(',', '.')));

  const hasOffer = /(?:medlemspris|erbjudande|veckans tips|rabatt|köp\s+\d+\s+betala)/i.test(text);
  const explicitNonNumericOffer = /\d+\s*%\s*rabatt|Köp\s+\d+\s+betala\s+för\s+\d+/i.test(text);
  return explicitNonNumericOffer
    ? { status: 'missing' }
    : {
        status: 'uncertain',
        value: null,
        note: hasOffer
          ? 'Coop angav ett erbjudande utan ett tolkningsbart pris.'
          : 'Priset kunde inte läsas säkert från Coop-sidan.',
      };
}

function parseRegularPrice(text) {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => /(?:ordinarie|ord\.)\s*pris/i.test(part));
  if (!line) return { status: 'missing' };
  const match = line.match(
    /(?:ordinarie|ord\.)\s*pris\s*:?\s*([\d ]+(?:[,.]\d{1,2})?)\s*(?:kronor|kr)\b/i,
  );
  if (!match) {
    return {
      status: 'uncertain',
      value: null,
      note: `Ordinarie pris kunde inte tolkas säkert: ${line.slice(0, 120)}`,
    };
  }
  const price = knownPrice(parseSwedishAmount(match[1]));
  return price.status === 'known'
    ? price
    : { ...price, note: `Ordinarie pris kunde inte tolkas säkert: ${line.slice(0, 120)}` };
}

function knownPrice(amount) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
    return { status: 'uncertain', value: null, note: 'Priset ligger utanför tillåtet intervall.' };
  }
  return { status: 'known', value: { amount, currency: 'SEK' } };
}

function parseSwedishAmount(value) {
  return Number(value.trim().replace(/\s/g, '').replace(',', '.'));
}

function parseBrand(text) {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)[1];
  if (!line) return { status: 'missing' };
  const prefix = line.match(/^([^.\d]+)\./)?.[1]?.trim();
  if (!prefix) return { status: 'missing' };

  const parts = prefix
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 2) {
    return { status: 'uncertain', value: null, note: 'Flera möjliga varumärken anges.' };
  }
  const brand = parts.at(-1);
  return brand ? { status: 'known', value: brand.slice(0, 100) } : { status: 'missing' };
}

function parsePackageSize(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1, 5);
  const sizeText = lines.find((line) => /\d[\d,. ]*\s*(?:g|kg|ml|l|st|styck)\b/i.test(line));
  if (!sizeText) return { status: 'missing' };

  if (/\d\s*[-–]\s*\d|\d\s*[x×]\s*\d/i.test(sizeText)) {
    return {
      status: 'uncertain',
      value: null,
      note: `Coop anger flera förpackningsstorlekar: ${sizeText.slice(0, 120)}`,
    };
  }
  const match = sizeText.match(/(?:^|[^\d])(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|st|styck)\b/i);
  if (!match) return { status: 'missing' };
  const unit = match[2].toLowerCase() === 'styck' ? 'st' : match[2].toLowerCase();
  return { status: 'known', value: { amount: Number(match[1].replace(',', '.')), unit } };
}

function parseUnitPrice(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.find((entry) => /(?:jfr-pris|jämförpris)/i.test(entry));
  if (!line) return { status: 'missing' };

  const match = line.match(
    /(?:jfr-pris|jämförpris)\s+([\d,.]+)(?:\s*[-–]\s*([\d,.]+))?\s*(?:kr|kronor)?\s*(?:\/\s*(kg|l|liter|st)|per\s+(kilo|liter|styck))\b/i,
  );
  if (!match) {
    return {
      status: 'uncertain',
      value: null,
      note: `Jämförpriset kunde inte tolkas säkert: ${line.slice(0, 120)}`,
    };
  }
  if (match[2]) {
    return {
      status: 'uncertain',
      value: null,
      note: `Jämförpriset anges som ett intervall: ${line.slice(0, 120)}`,
    };
  }
  const unit = (match[3] ?? match[4]).toLowerCase();
  return {
    status: 'known',
    value: {
      amount: Number(match[1].replace(',', '.')),
      currency: 'SEK',
      unit: unit === 'kilo' ? 'kg' : unit === 'liter' ? 'l' : unit === 'styck' ? 'st' : unit,
    },
  };
}

function parseConditions(text) {
  const conditions = [];
  const add = (value) => {
    const normalized = value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,;]+$/, '');
    if (normalized && !conditions.some((condition) => condition.text === normalized)) {
      conditions.push({
        text: normalized,
        kind: { status: 'known', value: classifyCondition(normalized) },
      });
    }
  };
  if (/medlemspris/i.test(text)) add('Medlemspris');

  for (const match of text.matchAll(
    /Max\s+\d+\s+(?:st|styck|köp|kg)(?:\s*\/\s*hushåll|\s+per\s+hushåll)/gi,
  ))
    add(match[0]);
  for (const match of text.matchAll(/\d+\s*%\s*rabatt(?:\s+vid\s+köp\s+av\s+\d+)?/gi))
    add(match[0]);
  for (const match of text.matchAll(/Köp\s+\d+\s+betala\s+för\s+\d+/gi)) add(match[0]);
  for (const match of text.matchAll(/\d+\s+för\s+[\d ,.:-]+\s*(?:kronor|kr)\b/gi)) add(match[0]);
  for (const match of text.matchAll(/Gäller ej [^.\n]+/gi)) add(match[0]);
  for (const match of text.matchAll(/Vid köp [^.\n]+/gi)) add(match[0]);
  if (/billigaste på köpet/i.test(text)) add('Billigaste på köpet');
  if (/pant tillkommer/i.test(text)) add('Pant tillkommer');

  const offerLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Erbjudande\b/i.test(line));
  if (offerLine && !/\d+(?:[,.]\d+)?\s+kronor/i.test(offerLine)) {
    for (const clause of offerLine.replace(/^Erbjudande\s*/i, '').split(/,\s*/)) add(clause);
  }
  return conditions.map((condition) => ({
    ...condition,
    ...(condition.kind.value === 'maximum_quantity'
      ? { requiredQuantity: { status: 'known', value: Number(condition.text.match(/\d+/)?.[0]) } }
      : {}),
  }));
}

function classifyCondition(text) {
  if (/medlemspris/i.test(text)) return 'member_only';
  if (/max\s+\d+/i.test(text)) return 'maximum_quantity';
  if (/minst|minimi|min\s+\d+/i.test(text)) return 'minimum_quantity';
  if (/\d+\s*%\s*rabatt.*vid köp|köp\s+\d+|för\s+\d+/i.test(text)) return 'multi_buy';
  return 'other';
}

function validateFlyerUrl(value, weekCode) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Coops reklambladslänk är ogiltig.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'dr.coop.se' ||
    url.pathname !== '/Butik/Stora-Coop-Lund' ||
    url.searchParams.get('c') !== weekCode ||
    [...url.searchParams.keys()].some((key) => key !== 'c')
  ) {
    throw new Error('Reklambladets länk tillhör inte Stora Coop Lund eller rätt vecka.');
  }
  return url.href;
}

function validatePdfEvidence(value, weekCode) {
  if (
    !value ||
    value.isPdf !== true ||
    value.storeMatch !== true ||
    !Number.isInteger(value.byteLength) ||
    value.byteLength < 50_000 ||
    value.byteLength > 15 * 1024 * 1024 ||
    !Number.isInteger(value.pageCount) ||
    value.pageCount < 1 ||
    value.pageCount > 30 ||
    !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')
  ) {
    throw new Error('PDF-filen kunde inte verifieras som Stora Coop Lunds reklamblad.');
  }
  normalizeFlyerValidityPeriod(value.validityPeriod, weekCode);
}

function normalizeFlyerValidityPeriod(value, weekCode) {
  if (
    !value ||
    typeof value.startDate !== 'string' ||
    typeof value.endDate !== 'string' ||
    !isValidDate(value.startDate) ||
    !isValidDate(value.endDate) ||
    value.startDate > value.endDate
  ) {
    throw new Error('Reklambladets giltighetsperiod kunde inte läsas säkert från PDF-filen.');
  }
  const week = getIsoWeekRange(weekCode);
  if (
    value.startDate < week.startDate ||
    value.startDate > week.endDate ||
    value.endDate < week.startDate ||
    value.endDate > week.endDate
  ) {
    throw new Error('Reklambladets angivna giltighetsperiod stämmer inte med PDF-länkens vecka.');
  }
  return { startDate: value.startDate, endDate: value.endDate };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getIsoWeekCode(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}
