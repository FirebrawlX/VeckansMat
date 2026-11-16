import { describe, expect, it } from 'vitest';
import {
  extractOfferSuggestions,
  normalizeOfferPdfPages,
  normalizeOfferSuggestions,
  validateOfferPublication,
} from './offer-import.js';

const page = [
  { str: 'Apelsiner i nät', x: 80, y: 80, fontSize: 10 },
  { str: '17k', x: 80, y: 120, fontSize: 58 },
  { str: 'Spanien/Coop.', x: 80, y: 69, fontSize: 8 },
];

describe('offer import validation', () => {
  it('accepts bounded positioned text and rejects invalid pages', () => {
    expect(normalizeOfferPdfPages([page])).toHaveLength(1);
    expect(() => normalizeOfferPdfPages([])).toThrow('mellan 1 och 30 sidor');
    expect(() => normalizeOfferPdfPages([[{ ...page[0], x: -1 }]])).toThrow('ogiltiga positioner');
  });

  it('keeps prices uncertain unless the AI price matches an exact source token', () => {
    const [verifiedToken, guessedToken] = normalizeOfferSuggestions({
      offers: [
        {
          page: 1,
          productName: 'Apelsiner i nät',
          brand: 'Coop',
          category: 'Frukt & grönt',
          offerPrice: 17,
          priceUnit: 'st',
          rawPrice: '17k',
          regularPrice: null,
          packageAmount: 1,
          packageUnit: 'kg',
          unitPriceAmount: null,
          unitPriceUnit: null,
          conditions: [],
          sourceLines: ['Apelsiner i nät', '17k'],
          confidence: 'high',
        },
        {
          page: 1,
          productName: 'Apelsiner i nät',
          brand: null,
          category: 'Frukt & grönt',
          offerPrice: 19,
          priceUnit: 'st',
          rawPrice: '17k',
          regularPrice: null,
          packageAmount: null,
          packageUnit: null,
          unitPriceAmount: null,
          unitPriceUnit: null,
          conditions: [],
          sourceLines: ['Apelsiner i nät', '17k'],
          confidence: 'high',
        },
      ],
    }, [page]);

    expect(verifiedToken.offerPrice).toBe(17);
    expect(verifiedToken.extractionConfidence).toBe('high');
    expect(guessedToken.offerPrice).toBeNull();
    expect(guessedToken.extractionConfidence).toBe('low');
  });

  it('calls only the selected free model and returns cited, validated suggestions', async () => {
    let requestedModel = '';
    const offers = await extractOfferSuggestions({
      run: async (model) => {
        requestedModel = model;
        return {
          response: JSON.stringify({
            offers: [{
              page: 1,
              productName: 'Apelsiner i nät',
              brand: 'Coop',
              category: 'Frukt & grönt',
              offerPrice: 17,
              priceUnit: 'st',
              rawPrice: '17k',
              regularPrice: null,
              packageAmount: null,
              packageUnit: null,
              unitPriceAmount: null,
              unitPriceUnit: null,
              conditions: [],
              sourceLines: ['Apelsiner i nät', '17k'],
              confidence: 'medium',
            }],
          }),
        };
      },
    }, [page]);

    expect(requestedModel).toBe('@cf/meta/llama-3.2-3b-instruct');
    expect(offers[0].offerPrice).toBe(17);
    expect(offers[0].sourceLines).toEqual(['Apelsiner i nät', '17k']);
  });

  it('splits larger flyers into bounded AI requests while retaining original page numbers', async () => {
    const requestedPages: number[] = [];
    const ai = {
      run: async (_model: string, options: { prompt: string; max_tokens: number }) => {
        const pageNumber = Number(options.prompt.match(/\nPAGE (\d+)\n/)?.[1]);
        requestedPages.push(pageNumber);
        expect(options.max_tokens).toBe(4096);
        return {
          response: JSON.stringify({
            offers: [{
              page: pageNumber,
              productName: 'Apelsiner i nät',
              brand: null,
              category: 'Frukt & grönt',
              offerPrice: 17,
              priceUnit: 'st',
              rawPrice: '17k',
              regularPrice: null,
              packageAmount: null,
              packageUnit: null,
              unitPriceAmount: null,
              unitPriceUnit: null,
              conditions: [],
              sourceLines: ['Apelsiner i nät', '17k'],
              confidence: 'medium',
            }],
          }),
        };
      },
    };

    const offers = await extractOfferSuggestions(ai, [page, page, page, page]);

    expect(requestedPages).toEqual([1, 4]);
    expect(offers.map((offer) => offer.sourcePage)).toEqual([1, 4]);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(2);
  });

  it('fails explicitly when the free AI binding is unavailable', async () => {
    await expect(extractOfferSuggestions(null, [page]))
      .rejects.toThrow('AI-tjänsten är inte tillgänglig');
  });

  it('rejects malformed AI output instead of accepting a partial suggestion list', async () => {
    await expect(extractOfferSuggestions({
      run: async () => ({ response: '{"offers":[{"productName":"Apelsiner"}' }),
    }, [page])).rejects.toThrow('svar som inte gick att läsa');
  });

  it('requires every suggestion to be reviewed before publication', () => {
    const [suggestion] = normalizeOfferSuggestions({
      offers: [{
        page: 1,
        productName: 'Apelsiner i nät',
        brand: 'Coop',
        category: 'Frukt & grönt',
        offerPrice: 17,
        priceUnit: 'st',
        rawPrice: '17k',
        regularPrice: null,
        packageAmount: null,
        packageUnit: null,
        unitPriceAmount: null,
        unitPriceUnit: null,
        conditions: [],
        sourceLines: ['Apelsiner i nät', '17k'],
        confidence: 'medium',
      }],
    }, [page]);
    const draft = { ...suggestion, include: true, verified: true };

    expect(() => validateOfferPublication({
      completeReview: true,
      validityPeriod: { startDate: '2026-11-16', endDate: '2026-11-22' },
      offers: [{ ...draft, verified: false }],
    }, [suggestion])).toThrow('Markera varje erbjudande');

    const publication = validateOfferPublication({
      completeReview: true,
      validityPeriod: { startDate: '2026-11-16', endDate: '2026-11-22' },
      offers: [draft],
    }, [suggestion]);
    expect(publication.offers[0].offerPrice).toEqual({ status: 'known', value: { amount: 17, currency: 'SEK' } });
    expect(publication.offers[0].regularPrice).toEqual({ status: 'missing' });
  });

  it('rejects invalid validity dates instead of inferring them', () => {
    expect(() => validateOfferPublication({
      completeReview: true,
      validityPeriod: { startDate: '2026-02-31', endDate: '2026-11-22' },
      offers: [],
    }, [])).toThrow('giltighetsperiod');
  });
});
