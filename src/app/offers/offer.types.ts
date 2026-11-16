export type OfferField<T> =
  | { status: 'known'; value: T }
  | { status: 'uncertain'; value: T | null; note: string }
  | { status: 'missing' };

export interface OfferDateRange {
  startDate: string;
  endDate: string;
}

export interface OfferPrice {
  amount: number;
  currency: 'SEK';
}

export interface OfferPackageSize {
  amount: number;
  unit: string;
}

export type OfferConditionKind = 'member_only' | 'minimum_quantity' | 'maximum_quantity' | 'multi_buy' | 'other';

export interface OfferCondition {
  text: string;
  kind: OfferField<OfferConditionKind>;
  requiredQuantity?: OfferField<number>;
}

export type OfferExtractionConfidence = 'high' | 'medium' | 'low' | 'not_assessed';

export interface OfferStore {
  id: string;
  retailer: string;
  name: string;
  city: string;
}

export interface OfferFlyer {
  id: string;
  storeId: string;
  sourceUrl: string;
  validityPeriod: OfferField<OfferDateRange>;
  sourceNote?: string;
}

export interface GroceryOffer {
  id: string;
  flyerId: string;
  productName: OfferField<string>;
  brand: OfferField<string>;
  category: OfferField<string>;
  offerPrice: OfferField<OfferPrice>;
  regularPrice: OfferField<OfferPrice>;
  packageSize: OfferField<OfferPackageSize>;
  unitPrice: OfferField<OfferPrice & { unit: string }>;
  validityPeriod: OfferField<OfferDateRange>;
  conditions: OfferField<OfferCondition[]>;
  sourcePage: OfferField<number>;
  extractionConfidence: OfferExtractionConfidence;
}

export interface OfferCatalog {
  stores: OfferStore[];
  flyers: OfferFlyer[];
  offers: GroceryOffer[];
}
