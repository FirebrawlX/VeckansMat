import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { OfferApiService, OfferReviewDraft } from './offer-api.service';
import { OfferImportComponent } from './offer-import.component';

function draft(overrides: Partial<OfferReviewDraft> = {}): OfferReviewDraft {
  return {
    id: 'page-1-offer-1',
    sourcePage: 1,
    productName: 'Apelsiner i nät',
    brand: 'Coop',
    category: 'Frukt & grönt',
    offerPrice: 17,
    priceUnit: 'st',
    regularPrice: null,
    packageSize: { amount: 1, unit: 'kg' },
    packageSizeText: '1 kg',
    unitPrice: null,
    unitPriceText: '',
    conditions: ['Medlemspris'],
    rawPrice: '17k',
    sourceLines: ['Apelsiner i nät', '17k'],
    duplicateOf: null,
    extractionConfidence: 'low',
    include: true,
    verified: false,
    ...overrides,
  };
}

describe('OfferImportComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfferImportComponent],
      providers: [{
        provide: OfferApiService,
        useValue: { extract: async () => ({}), publish: async () => ({}) },
      }],
    }).compileComponents();
  });

  it('requires a valid date range, review of every candidate, and a completeness confirmation', () => {
    const component = TestBed.createComponent(OfferImportComponent).componentInstance;
    component.runId = 'import-id';
    component.suggestions = [draft()];
    component.validityStart = '2026-11-16';
    component.validityEnd = '2026-11-22';
    component.completeReview = true;

    expect(component.canPublish).toBe(false);
    component.suggestions[0].verified = true;
    expect(component.canPublish).toBe(true);

    component.validityEnd = '2026-11-15';
    expect(component.canPublish).toBe(false);
  });

  it('lets the reviewer exclude a false positive while still requiring review', () => {
    const component = TestBed.createComponent(OfferImportComponent).componentInstance;
    component.runId = 'import-id';
    component.suggestions = [
      draft({ include: false, verified: true, packageSizeText: 'uncertain' }),
      draft({ id: 'page-1-offer-2', verified: true }),
    ];
    component.validityStart = '2026-11-16';
    component.validityEnd = '2026-11-22';
    component.completeReview = true;

    expect(component.allOffersVerified).toBe(true);
    expect(component.packageFieldsAreValid).toBe(true);
    expect(component.canPublish).toBe(true);
  });

  it('rejects malformed package and unit-price text instead of silently publishing it', () => {
    const component = TestBed.createComponent(OfferImportComponent).componentInstance;
    component.suggestions = [draft({ packageSizeText: '500', unitPriceText: '29/kg' })];

    expect(component.packageFieldsAreValid).toBe(false);
    expect(component.parsePackageSize('500 g')).toEqual({ amount: 500, unit: 'g' });
    expect(component.parseUnitPrice('29,90 kr/kg')).toEqual({ amount: 29.9, currency: 'SEK', unit: 'kg' });
  });

  it('rejects impossible calendar dates', () => {
    const component = TestBed.createComponent(OfferImportComponent).componentInstance;
    component.validityStart = '2026-02-31';
    component.validityEnd = '2026-03-01';

    expect(component.datesAreValid).toBe(false);
  });
});
