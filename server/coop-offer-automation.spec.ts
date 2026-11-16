import { describe, expect, it } from 'vitest';
import {
  getCurrentCoopWeekCode,
  getIsoWeekRange,
  hasValidAutomationToken,
  normalizeAutomatedOfferPayload,
  parseCoopOfferCard,
} from './coop-offer-automation.js';

const now = new Date('2026-11-16T12:00:00.000Z');
const weekCode = '2026-47';
const categories = [
  'Bröd & bageri',
  'Deli & chark',
  'Frukt & grönt',
  'Frysvaror',
  'Fågel, fisk & kött',
  'Godis & snacks',
  'Hem & fritid',
  'Kaffe & dryck',
  'Mejeri & ägg',
  'Skafferi',
];

function payload() {
  const categoryCounts = categories.map((name) => ({ name, count: 2 }));
  const cards = categoryCounts.flatMap(({ name }, categoryIndex) =>
    Array.from({ length: 2 }, (_, itemIndex) => {
      const defaultName = `Produkt ${categoryIndex * 2 + itemIndex + 1}`;
      const productName =
        categoryIndex === 4 ? `Lax ${categoryIndex * 2 + itemIndex + 1}` : defaultName;
      return {
        productName,
        sourceCategory: name,
        text: `${productName}\nCoop.\nErbjudande\n69,90 kronor\n500 g\nJfr-pris 139,80/kg`,
      };
    }),
  );
  return {
    storeId: 'coop-lund',
    storeName: 'Stora Coop Lund',
    storePageUrl: 'https://www.coop.se/butiker-erbjudanden/stora-coop/stora-coop-lund/',
    flyerUrl: `https://dr.coop.se/Butik/Stora-Coop-Lund?c=${weekCode}`,
    weekCode,
    expectedOfferCount: cards.length,
    categoryCounts,
    pdfEvidence: {
      isPdf: true,
      storeMatch: true,
      byteLength: 80_000,
      pageCount: 12,
      sha256: 'a'.repeat(64),
      validityPeriod: { startDate: '2026-11-16', endDate: '2026-11-22' },
    },
    cards,
  };
}

describe('automated Coop offer validation', () => {
  it('uses the Swedish local ISO week and calculates the flyer validity period', () => {
    expect(getCurrentCoopWeekCode(now)).toBe(weekCode);
    expect(getIsoWeekRange(weekCode)).toEqual({ startDate: '2026-11-16', endDate: '2026-11-22' });
  });

  it('normalizes a complete Stora Coop Lund offer list with comma-decimal prices', () => {
    const result = normalizeAutomatedOfferPayload(payload(), now);

    expect(result.offers).toHaveLength(20);
    expect(result.offers[0].offerPrice).toEqual({
      status: 'known',
      value: { amount: 69.9, currency: 'SEK' },
    });
    expect(result.offers[0].packageSize).toEqual({
      status: 'known',
      value: { amount: 500, unit: 'g' },
    });
    expect(result.offers[0].unitPrice).toEqual({
      status: 'known',
      value: { amount: 139.8, currency: 'SEK', unit: 'kg' },
    });
    expect(result.offers[8].category).toEqual({ status: 'known', value: 'Fisk & skaldjur' });
    expect(result.offers[12].category).toEqual({ status: 'known', value: 'Övrigt' });
    expect(result.offers[0].validityPeriod.value).toEqual({
      startDate: '2026-11-16',
      endDate: '2026-11-22',
    });
  });

  it('preserves member and multi-buy conditions without treating a discount as a cash price', () => {
    const memberOffer = parseCoopOfferCard(
      {
        productName: 'Kaffe',
        sourceCategory: 'Skafferi',
        text: 'Kaffe\nCoop.\nErbjudande\n2 för 69 kronor, Jämförpris 34,50 per styck\nMedlemspris\nMax 2 st/hushåll',
      },
      0,
      weekCode,
    );
    const percentageOffer = parseCoopOfferCard(
      {
        productName: 'Babyvård',
        sourceCategory: 'Hem & fritid',
        text: 'Babyvård\nErbjudande 20% rabatt vid köp av 2',
      },
      1,
      weekCode,
    );

    expect(memberOffer.offerPrice).toEqual({
      status: 'known',
      value: { amount: 69, currency: 'SEK' },
    });
    expect(memberOffer.conditions.value.map(({ text }) => text)).toEqual([
      'Medlemspris',
      'Max 2 st/hushåll',
      '2 för 69 kronor',
    ]);
    expect(percentageOffer.offerPrice).toEqual({ status: 'missing' });
    expect(percentageOffer.conditions.value.map(({ text }) => text)).toContain(
      '20% rabatt vid köp av 2',
    );
  });

  it('does not assume a department when Coop provides a combined meat-and-fish category', () => {
    const offer = parseCoopOfferCard(
      {
        productName: 'Färdigrätter',
        sourceCategory: 'Fågel, fisk & kött',
        text: 'Färdigrätter\nDafgårds.\nErbjudande 2 för 99 kronor',
      },
      0,
      weekCode,
    );

    expect(offer.category.status).toBe('uncertain');
  });

  it('rejects a wrong store, outdated week, incomplete categories, and unverifiable PDF evidence', () => {
    const wrongStore = payload();
    wrongStore.storeName = 'Stora Coop Malmö';
    expect(() => normalizeAutomatedOfferPayload(wrongStore, now)).toThrow('Stora Coop Lund');

    const outdatedFlyer = payload();
    outdatedFlyer.weekCode = '2026-46';
    expect(() => normalizeAutomatedOfferPayload(outdatedFlyer, now)).toThrow('innevarande vecka');

    const incomplete = payload();
    incomplete.categoryCounts.pop();
    expect(() => normalizeAutomatedOfferPayload(incomplete, now)).toThrow('antalet');

    const invalidPdf = payload();
    invalidPdf.pdfEvidence.sha256 = 'invalid';
    expect(() => normalizeAutomatedOfferPayload(invalidPdf, now)).toThrow('PDF-filen');
  });

  it('rejects a product whose price cannot be read with certainty', () => {
    expect(() =>
      parseCoopOfferCard(
        {
          productName: 'Kaffe',
          sourceCategory: 'Skafferi',
          text: 'Kaffe\nErbjudande\nSe pris i butik',
        },
        0,
        weekCode,
      ),
    ).toThrow('läsa priset');
  });

  it('checks a long bearer token without accepting malformed authorization headers', () => {
    const token = 'a'.repeat(48);
    expect(
      hasValidAutomationToken(
        new Request('https://example.test', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        token,
      ),
    ).toBe(true);
    expect(
      hasValidAutomationToken(
        new Request('https://example.test', {
          headers: { Authorization: `Bearer ${'b'.repeat(48)}` },
        }),
        token,
      ),
    ).toBe(false);
    expect(
      hasValidAutomationToken(
        new Request('https://example.test', {
          headers: { Authorization: token },
        }),
        token,
      ),
    ).toBe(false);
  });
});
