import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { extractTextItems, getDocumentProxy } from 'unpdf';
import { chromium } from 'playwright';
import {
  getCurrentCoopWeekCode,
  getIsoWeekRange,
  normalizeAutomatedOfferPayload,
} from '../server/coop-offer-automation.js';

const STORE_ID = 'coop-lund';
const STORE_NAME = 'Stora Coop Lund';
const STORE_PAGE_URL = 'https://www.coop.se/butiker-erbjudanden/stora-coop/stora-coop-lund/';
const AUTOMATION_API_URL = 'https://veckansmat.veckans-mat.workers.dev/api/offers';
const MAX_PDF_SIZE = 15 * 1024 * 1024;
const CATEGORY_LABEL = /^(.+?),\s*(\d+)\s+varor?,\s*filtrera varor\s*$/i;

export async function collectOfferCards(page) {
  await page.goto(STORE_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const finalUrl = new URL(page.url());
  if (
    finalUrl.origin !== 'https://www.coop.se' ||
    finalUrl.pathname !== new URL(STORE_PAGE_URL).pathname
  ) {
    throw new Error('Coop skickade vidare till en annan sida än Stora Coop Lund.');
  }

  await page.getByRole('heading', { name: STORE_NAME, exact: true }).waitFor({ timeout: 30_000 });
  const consentButton = page.getByRole('button', {
    name: 'Endast nödvändiga cookies',
    exact: true,
  });
  if (await consentButton.count()) await consentButton.click({ timeout: 15_000 });

  const identity = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.innerText.trim() ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
  }));
  if (identity.heading !== STORE_NAME || identity.canonical !== STORE_PAGE_URL) {
    throw new Error('Coops sididentitet stämmer inte med Stora Coop Lund.');
  }

  const flyerLink = await findCurrentFlyerLink(page);
  const categories = await page.locator('button[aria-label]').evaluateAll((buttons) =>
    buttons.map((button) => ({
      accessibleName: button.getAttribute('aria-label') ?? '',
      pressed: button.getAttribute('aria-pressed') === 'true',
    })),
  );
  const totalButton = categories.find((button) =>
    /^Alla varor,\s*\d+\s+varor\b/i.test(button.accessibleName),
  );
  const expectedOfferCount = Number(
    totalButton?.accessibleName.match(/^Alla varor,\s*(\d+)\s+varor\b/i)?.[1],
  );
  const categoryCounts = categories.flatMap(({ accessibleName }) => {
    const match = accessibleName.match(CATEGORY_LABEL);
    return match ? [{ name: match[1].trim(), count: Number(match[2]) }] : [];
  });
  if (
    !Number.isInteger(expectedOfferCount) ||
    categoryCounts.length !== 10 ||
    categoryCounts.reduce((sum, item) => sum + item.count, 0) !== expectedOfferCount
  ) {
    throw new Error('Coops avdelningsfilter verkar ofullständiga eller har ändrat format.');
  }

  const cards = [];
  for (const category of categoryCounts) {
    const filter = categories.find(({ accessibleName }) => {
      const match = accessibleName.match(CATEGORY_LABEL);
      return match?.[1].trim() === category.name;
    });
    if (!filter) throw new Error(`Avdelningsfiltret "${category.name}" kunde inte hittas.`);
    const button = page.getByRole('button', { name: filter.accessibleName, exact: true });
    await button.click({ timeout: 15_000 });
    await page.waitForFunction(
      (expected) =>
        [...document.querySelectorAll('h3')].filter((heading) => {
          const productName = heading.innerText.trim();
          const card = heading.closest('li');
          return Boolean(
            productName &&
            card &&
            [...card.querySelectorAll('button')].some((button) =>
              (button.getAttribute('aria-label') ?? '').includes(productName),
            ),
          );
        }).length === expected,
      category.count,
      { timeout: 15_000 },
    );

    const categoryCards = await page.evaluate(collectVisibleOfferCards);
    if (categoryCards.length !== category.count) {
      throw new Error(`Antalet erbjudanden i "${category.name}" stämmer inte med Coop-sidan.`);
    }
    cards.push(...categoryCards.map((card) => ({ ...card, sourceCategory: category.name })));
  }

  if (cards.length !== expectedOfferCount)
    throw new Error('Alla Coop-erbjudanden kunde inte läsas in.');
  return { flyerLink, expectedOfferCount, categoryCounts, cards };
}

export function collectVisibleOfferCards() {
  return [...document.querySelectorAll('h3')].flatMap((heading) => {
    const productName = heading.innerText.trim();
    const card = heading.closest('li');
    if (!productName || !card) return [];
    const hasProductAction = [...card.querySelectorAll('button')].some((button) =>
      (button.getAttribute('aria-label') ?? '').includes(productName),
    );
    if (!hasProductAction) return [];
    return [{ productName, text: card.innerText.trim() }];
  });
}

async function findCurrentFlyerLink(page) {
  const links = await page
    .locator('a[href]')
    .evaluateAll((elements) =>
      elements
        .map((element) => ({ href: element.href, text: element.innerText.trim() }))
        .filter((link) => link.text.toLowerCase().includes('pdf')),
    );
  const flyerLinks = links.filter(({ href }) => {
    try {
      const url = new URL(href);
      return url.hostname === 'dr.coop.se' && url.pathname === '/Butik/Stora-Coop-Lund';
    } catch {
      return false;
    }
  });
  if (flyerLinks.length !== 1)
    throw new Error('Coops sida innehåller inte exakt en PDF-länk för Stora Coop Lund.');

  const url = new URL(flyerLinks[0].href);
  const weekCode = url.searchParams.get('c');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    weekCode !== getCurrentCoopWeekCode() ||
    [...url.searchParams.keys()].some((key) => key !== 'c')
  ) {
    throw new Error('Coops PDF-länk gäller inte innevarande vecka.');
  }
  return { url: url.href, weekCode };
}

async function verifyFlyerPdf(page, flyerUrl, weekCode) {
  const response = await page.request.get(flyerUrl, { timeout: 45_000 });
  if (!response.ok()) throw new Error(`Coops PDF kunde inte laddas ned (${response.status()}).`);
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/pdf')) {
    throw new Error('Coops reklambladslänk returnerade inte en PDF-fil.');
  }
  const contentLength = Number(response.headers()['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_SIZE) {
    throw new Error('Coops reklamblad är större än tillåtet.');
  }

  const bytes = await response.body();
  if (
    bytes.length < 50_000 ||
    bytes.length > MAX_PDF_SIZE ||
    bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) {
    throw new Error(
      'Den nedladdade reklambladsfilen har ett ogiltigt format eller en ogiltig storlek.',
    );
  }

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { items } = await extractTextItems(pdf);
  const lundPages = items.filter((itemsOnPage) =>
    itemsOnPage.some((item) => /lund/i.test(item.str)),
  ).length;
  if (items.length < 1 || items.length > 30 || lundPages < Math.min(items.length, 3)) {
    throw new Error('PDF-innehållet kunde inte verifieras som Stora Coop Lunds reklamblad.');
  }
  const validityPeriod = parseFlyerValidityPeriod(
    items.map((itemsOnPage) => itemsOnPage.map((item) => item.str).join(' ')).join('\n'),
    weekCode,
  );

  return {
    isPdf: true,
    storeMatch: true,
    byteLength: bytes.length,
    pageCount: items.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    validityPeriod,
  };
}

export function parseFlyerValidityPeriod(text, weekCode) {
  const matches = [
    ...text.matchAll(/\bPRISER\s+(\d{1,2})\/(\d{1,2})\s*[–-]\s*(\d{1,2})\/(\d{1,2})\b/gi),
  ];
  if (matches.length !== 1) {
    throw new Error('Reklambladets giltighetsdatum kunde inte identifieras entydigt i PDF-filen.');
  }
  const weekYear = Number(weekCode.slice(0, 4));
  const week = getIsoWeekRange(weekCode);
  const start = matches[0];
  for (const year of [weekYear - 1, weekYear, weekYear + 1]) {
    const startDate = formatFlyerDate(year, Number(start[2]), Number(start[1]));
    const endYear = Number(start[4]) < Number(start[2]) ? year + 1 : year;
    const endDate = formatFlyerDate(endYear, Number(start[4]), Number(start[3]));
    if (
      startDate &&
      endDate &&
      startDate >= week.startDate &&
      startDate <= week.endDate &&
      endDate >= startDate &&
      endDate <= week.endDate
    ) {
      return { startDate, endDate };
    }
  }
  throw new Error('Reklambladets angivna giltighetsperiod stämmer inte med PDF-länkens vecka.');
}

function formatFlyerDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString().slice(0, 10);
}

export async function scrapeCoopOffers() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'sv-SE', timezoneId: 'Europe/Stockholm' });
    const scraped = await collectOfferCards(page);
    const pdfEvidence = await verifyFlyerPdf(
      page,
      scraped.flyerLink.url,
      scraped.flyerLink.weekCode,
    );
    const payload = {
      storeId: STORE_ID,
      storeName: STORE_NAME,
      storePageUrl: STORE_PAGE_URL,
      flyerUrl: scraped.flyerLink.url,
      weekCode: scraped.flyerLink.weekCode,
      expectedOfferCount: scraped.expectedOfferCount,
      categoryCounts: scraped.categoryCounts,
      pdfEvidence,
      cards: scraped.cards,
    };
    const normalized = normalizeAutomatedOfferPayload(payload);
    return { payload, normalized, pdfEvidence };
  } finally {
    await browser.close();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = process.env.OFFER_AUTOMATION_TOKEN;
  if (!dryRun && !token)
    throw new Error('GitHub Actions secret OFFER_AUTOMATION_TOKEN is not configured.');

  try {
    const { payload, normalized, pdfEvidence } = await scrapeCoopOffers();
    const summary = {
      store: STORE_NAME,
      week: payload.weekCode,
      offerCount: normalized.offers.length,
      categories: payload.categoryCounts,
      offersWithKnownPrice: normalized.offers.filter((offer) => offer.offerPrice.status === 'known')
        .length,
      offersWithMissingPrice: normalized.offers.filter(
        (offer) => offer.offerPrice.status === 'missing',
      ).length,
      productsWithoutCashPrice: normalized.offers.flatMap((offer, index) =>
        offer.offerPrice.status === 'known'
          ? []
          : [
              {
                productName: offer.productName.value,
                sourceText: payload.cards[index].text,
              },
            ],
      ),
      uncertainCategories: normalized.offers
        .filter((offer) => offer.category.status === 'uncertain')
        .map((offer) => offer.productName.value),
      uncertainPackaging: normalized.offers.filter(
        (offer) => offer.packageSize.status === 'uncertain',
      ).length,
      uncertainUnitPrices: normalized.offers.filter(
        (offer) => offer.unitPrice.status === 'uncertain',
      ).length,
      pdf: { bytes: pdfEvidence.byteLength, pages: pdfEvidence.pageCount },
    };
    if (dryRun) {
      console.log(JSON.stringify({ mode: 'dry-run', ...summary }));
      return;
    }

    const result = await postJson(`${AUTOMATION_API_URL}/automated-publish`, payload, token);
    console.log(
      JSON.stringify({
        mode: 'published',
        ...summary,
        alreadyPublished: result.alreadyPublished === true,
      }),
    );
  } catch (error) {
    if (!dryRun && token) {
      try {
        await postJson(
          `${AUTOMATION_API_URL}/automated-failure`,
          {
            storeId: STORE_ID,
            weekCode: getCurrentCoopWeekCode(),
          },
          token,
        );
      } catch {
        console.error('Could not record the failed import status.');
      }
    }
    throw error;
  }
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof result?.error === 'string'
        ? result.error
        : `Automatisk import misslyckades (${response.status}).`;
    throw new Error(message);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Coop-importen misslyckades.');
    process.exitCode = 1;
  });
}
