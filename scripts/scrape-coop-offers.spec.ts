import { describe, expect, it } from 'vitest';
import { parseFlyerValidityPeriod } from './scrape-coop-offers.mjs';

describe('Coop flyer PDF validation', () => {
  it('uses the printed flyer validity dates rather than inferring the full ISO week', () => {
    expect(parseFlyerValidityPeriod('PRISER 16/11–22/11', '2026-47')).toEqual({
      startDate: '2026-11-16',
      endDate: '2026-11-22',
    });
  });

  it('handles a printed period spanning the end of the calendar year', () => {
    expect(parseFlyerValidityPeriod('PRISER 28/12–3/1', '2026-53')).toEqual({
      startDate: '2026-12-28',
      endDate: '2027-01-03',
    });
  });

  it('rejects missing, ambiguous, or week-mismatched dates', () => {
    expect(() => parseFlyerValidityPeriod('Ingen datum', '2026-47')).toThrow(
      'kunde inte identifieras entydigt',
    );
    expect(() =>
      parseFlyerValidityPeriod('PRISER 16/11–22/11 PRISER 16/11–22/11', '2026-47'),
    ).toThrow('kunde inte identifieras entydigt');
    expect(() => parseFlyerValidityPeriod('PRISER 9/11–15/11', '2026-47')).toThrow('stämmer inte');
  });
});
