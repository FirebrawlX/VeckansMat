import { extractTextItems, getDocumentProxy } from 'unpdf';
import type { OfferExtractionConfidence } from './offer.types';
import { parseCoopPriceToken } from './coop-price';

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_PAGE_COUNT = 30;
const PARSE_TIMEOUT_MS = 15_000;
const COOP_TITLE_FONT_SIZE = 10;

export interface PositionedPdfText {
  str: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface OfferPdfCandidate {
  id: string;
  sourcePage: number;
  productName: string | null;
  rawPrice: string;
  parsedPrice: number | null;
  confidence: OfferExtractionConfidence;
}

export interface OfferPdfExtraction {
  pageCount: number;
  candidates: OfferPdfCandidate[];
  warnings: string[];
}

export type OfferPdfPages = PositionedPdfText[][];

export async function readCoopOfferPdfPages(file: File): Promise<OfferPdfPages> {
  validatePdfFile(file);
  return parsePdf(file);
}

export async function extractCoopOffersFromPdf(file: File): Promise<OfferPdfExtraction> {
  const parse = readCoopOfferPdfPages(file).then(parseCoopOfferPages);
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      parse,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('PDF-filen tog för lång tid att läsa.')),
          PARSE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export function parseCoopOfferPages(pages: PositionedPdfText[][]): OfferPdfExtraction {
  if (!pages.length || pages.length > MAX_PAGE_COUNT) {
    throw new Error('Reklambladet måste innehålla mellan 1 och 30 sidor.');
  }

  const candidates: OfferPdfCandidate[] = [];
  const warnings: string[] = [];

  pages.forEach((items, pageIndex) => {
    const visibleItems = items.filter((item) => item.str.trim());
    if (!visibleItems.length) {
      warnings.push(`Sida ${pageIndex + 1} saknar extraherbar text.`);
      return;
    }

    const titles = collectCoopProductTitles(visibleItems);
    const prices = collectCoopPrices(visibleItems);
    for (const [priceIndex, price] of prices.entries()) {
      const nearest = titles
        .map((title) => ({ title, distance: Math.hypot(title.x - price.x, title.y - price.y) }))
        .sort((left, right) => left.distance - right.distance);
      const closest = nearest[0];
      const next = nearest[1];
      const productName = closest && closest.distance <= 220 ? closest.title.text : null;
      const confidence = closest
        && closest.distance <= 100
        && (!next || next.distance - closest.distance >= 18)
        ? 'medium'
        : 'low';

      candidates.push({
        id: `page-${pageIndex + 1}-price-${priceIndex + 1}`,
        sourcePage: pageIndex + 1,
        productName,
        rawPrice: price.str,
        parsedPrice: parseCoopPriceToken(price.str),
        confidence,
      });
    }
  });

  if (!candidates.length) {
    throw new Error('Hittade inga läsbara erbjudandepriser i PDF-filen.');
  }

  return { pageCount: pages.length, candidates, warnings };
}

async function parsePdf(file: File): Promise<OfferPdfPages> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
  if (pdf.numPages > MAX_PAGE_COUNT) {
    throw new Error('Reklambladet får innehålla högst 30 sidor.');
  }

  const { items } = await extractTextItems(pdf);
  return items.map((page) => page
    .filter((item) => item.str.trim())
    .map(({ str, x, y, fontSize }) => ({ str, x, y, fontSize })));
}

function validatePdfFile(file: File): void {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Välj en PDF-fil.');
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    throw new Error('PDF-filen måste vara större än 0 byte och högst 15 MB.');
  }
}

function collectCoopProductTitles(items: PositionedPdfText[]): { text: string; x: number; y: number }[] {
  const titleItems = items
    .filter((item) => Math.abs(item.fontSize - COOP_TITLE_FONT_SIZE) < 0.2)
    .filter((item) => !/^(?:MAX\b|Jfr-pris\b|Latin:|Veckans\b)/i.test(item.str.trim()))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const titles: { text: string; x: number; y: number }[] = [];

  for (const item of titleItems) {
    const previous = titles.find((title) => Math.abs(title.x - item.x) <= 8 && Math.abs(title.y - item.y) <= 14);
    if (previous) {
      previous.text = `${item.str.trim()} ${previous.text}`.trim();
      previous.x = Math.min(previous.x, item.x);
      previous.y = Math.max(previous.y, item.y);
    } else {
      titles.push({ text: item.str.trim(), x: item.x, y: item.y });
    }
  }

  return titles;
}

function collectCoopPrices(items: PositionedPdfText[]): PositionedPdfText[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!/^\d{1,4}(?:k|=\)|\)=)$/.test(item.str.trim()) || item.fontSize < 35) return false;
    const key = `${Math.round(item.x)}:${Math.round(item.y)}:${item.str.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
