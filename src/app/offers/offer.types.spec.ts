import { describe, expect, it } from 'vitest';
import { illustrativeOfferCatalog } from './offer.examples';

describe('offer data model examples', () => {
  it('associates offers with the store and validity period of their flyer', () => {
    const catalog = illustrativeOfferCatalog;
    const storeById = new Map(catalog.stores.map((store) => [store.id, store]));

    for (const offer of catalog.offers) {
      const flyer = catalog.flyers.find((item) => item.id === offer.flyerId);

      expect(flyer).toBeDefined();
      expect(flyer && storeById.has(flyer.storeId)).toBe(true);
    }

    expect(storeById.get(catalog.flyers[0].storeId)?.city).toBe('Lund');
    expect(catalog.offers[0].validityPeriod.status).toBe('known');
  });

  it('represents unclear and unavailable details without filling in guesses', () => {
    const uncertainOffer = illustrativeOfferCatalog.offers.find((offer) => offer.id === 'demo-uncertain');

    expect(uncertainOffer?.offerPrice).toEqual({
      status: 'uncertain',
      value: null,
      note: 'Priset går inte att läsa i det här exempelunderlaget.',
    });
    expect(uncertainOffer?.packageSize).toEqual({ status: 'missing' });
    expect(uncertainOffer?.conditions.status).toBe('uncertain');
    expect(uncertainOffer?.validityPeriod.status).toBe('known');
    expect(uncertainOffer?.extractionConfidence).toBe('low');
  });
});
