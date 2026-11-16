import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { OfferPdfPages } from './offer-pdf-extractor';
import type { OfferCatalog, OfferExtractionConfidence, OfferPackageSize, OfferPrice } from './offer.types';

export interface OfferExtractionSuggestion {
  id: string;
  sourcePage: number;
  productName: string | null;
  brand: string | null;
  category: string;
  offerPrice: number | null;
  priceUnit: string;
  regularPrice: number | null;
  packageSize: OfferPackageSize | null;
  unitPrice: (OfferPrice & { unit: string }) | null;
  conditions: string[];
  rawPrice: string | null;
  sourceLines: string[];
  duplicateOf: string | null;
  extractionConfidence: OfferExtractionConfidence;
}

export interface OfferReviewDraft extends Omit<OfferExtractionSuggestion, 'id' | 'packageSize' | 'unitPrice'> {
  id: string;
  packageSize: OfferPackageSize | null;
  packageSizeText: string;
  unitPrice: (OfferPrice & { unit: string }) | null;
  unitPriceText: string;
  include: boolean;
  verified: boolean;
}

export type OfferPublishDraft = Omit<OfferReviewDraft, 'packageSizeText' | 'unitPriceText'>;

export interface OfferExtractionResponse {
  runId: string;
  sourceHash: string;
  pageCount: number;
  offers: OfferExtractionSuggestion[];
  warnings: string[];
  alreadyPublished: boolean;
  catalog?: OfferCatalog;
}

export interface OfferPublishedResponse {
  catalog: OfferCatalog | null;
  publishedAt: number | null;
  lastImport: {
    status: 'processing' | 'review' | 'published' | 'failed';
    startedAt: number;
    completedAt: number | null;
    message: string;
  } | null;
}

@Injectable({ providedIn: 'root' })
export class OfferApiService {
  private readonly http = inject(HttpClient);

  getPublished(): Promise<OfferPublishedResponse> {
    return firstValueFrom(this.http.get<OfferPublishedResponse>('/api/offers', { withCredentials: true }));
  }

  extract(pages: OfferPdfPages): Promise<OfferExtractionResponse> {
    return firstValueFrom(this.http.post<OfferExtractionResponse>(
      '/api/offers/extract',
      { pages },
      { withCredentials: true },
    ));
  }

  publish(input: {
    runId: string;
    validityPeriod: { startDate: string; endDate: string };
    offers: OfferPublishDraft[];
    completeReview: boolean;
  }): Promise<OfferCatalog> {
    return firstValueFrom(this.http.post<OfferCatalog>('/api/offers/publish', input, { withCredentials: true }));
  }
}
