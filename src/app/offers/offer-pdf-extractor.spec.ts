import { describe, expect, it } from 'vitest';
import { parseCoopOfferPages } from './offer-pdf-extractor';
import type { PositionedPdfText } from './offer-pdf-extractor';
import { parseCoopPriceToken } from './coop-price';

function item(str: string, x: number, y: number, fontSize = 10): PositionedPdfText {
  return { str, x, y, fontSize };
}

describe('Coop PDF offer extraction', () => {
  it('decodes the observed Coop price glyphs without guessing unknown formats', () => {
    expect(parseCoopPriceToken('17k')).toBe(17);
    expect(parseCoopPriceToken('69)=')).toBe(69.9);
    expect(parseCoopPriceToken('29=)')).toBe(29.9);
    expect(parseCoopPriceToken('69,90')).toBeNull();
    expect(parseCoopPriceToken('0k')).toBeNull();
  });

  it('associates positioned price candidates with a nearby product title and keeps them flagged for review', () => {
    const result = parseCoopOfferPages([[
      item('Apelsiner i nät', 86, 80),
      item('Spanien/Coop.', 87, 69, 8),
      item('17k', 79, 127, 58),
      item('17k', 79, 127, 58),
    ]]);

    expect(result.candidates).toEqual([{
      id: 'page-1-price-1',
      sourcePage: 1,
      productName: 'Apelsiner i nät',
      rawPrice: '17k',
      parsedPrice: 17,
      confidence: 'medium',
    }]);
  });

  it('does not make up a product name when no title is close enough', () => {
    const result = parseCoopOfferPages([[
      item('Apelsiner i nät', 86, 80),
      item('17k', 700, 700, 58),
    ]]);

    expect(result.candidates[0].productName).toBeNull();
    expect(result.candidates[0].confidence).toBe('low');
  });

  it('warns when any page has no extractable text', () => {
    const result = parseCoopOfferPages([[], [item('17k', 20, 20, 58)]]);

    expect(result.warnings).toEqual(['Sida 1 saknar extraherbar text.']);
    expect(result.candidates[0].sourcePage).toBe(2);
  });

  it('rejects flyers outside the supported page limit', () => {
    expect(() => parseCoopOfferPages(Array.from({ length: 31 }, () => [])))
      .toThrow('Reklambladet måste innehålla mellan 1 och 30 sidor.');
  });
});
