import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OfferApiService } from './offer-api.service';
import type { OfferReviewDraft } from './offer-api.service';
import { readCoopOfferPdfPages } from './offer-pdf-extractor';
import type { OfferCatalog, OfferPackageSize, OfferPrice } from './offer.types';

const DEPARTMENTS = [
  'Frukt & grönt',
  'Kött & chark',
  'Fisk & skaldjur',
  'Mejeri & ost',
  'Bröd & bageri',
  'Skafferi',
  'Fryst',
  'Dryck',
  'Godis & snacks',
  'Övrigt',
];

@Component({
  selector: 'app-offer-import',
  imports: [FormsModule],
  templateUrl: './offer-import.component.html',
  styleUrl: './offer-import.component.css',
})
export class OfferImportComponent {
  @Output() readonly published = new EventEmitter<OfferCatalog>();

  readonly departments = DEPARTMENTS;
  private readonly offersApi = inject(OfferApiService);

  fileName = '';
  pageCount = 0;
  runId = '';
  suggestions: OfferReviewDraft[] = [];
  warnings: string[] = [];
  validityStart = '';
  validityEnd = '';
  completeReview = false;
  readingPdf = false;
  publishing = false;
  error = '';
  message = '';

  async selectPdf(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;

    this.resetPreview();
    this.fileName = file.name;
    this.readingPdf = true;
    try {
      const pages = await readCoopOfferPdfPages(file);
      this.pageCount = pages.length;
      const result = await this.offersApi.extract(pages);
      this.warnings = result.warnings;
      if (result.alreadyPublished && result.catalog) {
        this.message = 'Det här reklambladet är redan publicerat.';
        this.published.emit(result.catalog);
        return;
      }

      this.runId = result.runId;
      this.suggestions = result.offers.map((offer) => ({
        ...offer,
        packageSizeText: offer.packageSize ? `${offer.packageSize.amount} ${offer.packageSize.unit}` : '',
        unitPriceText: offer.unitPrice ? `${offer.unitPrice.amount} kr/${offer.unitPrice.unit}` : '',
        include: true,
        verified: false,
      }));
      if (!this.suggestions.length) this.error = 'AI:n hittade inga erbjudanden att granska.';
    } catch (error) {
      this.error = this.errorMessage(error, 'Kunde inte läsa reklambladet. Försök igen.');
    } finally {
      this.readingPdf = false;
      input.value = '';
    }
  }

  updateConditions(offer: OfferReviewDraft, value: string): void {
    offer.conditions = value.split('\n').map((condition) => condition.trim()).filter(Boolean);
  }

  conditionsText(offer: OfferReviewDraft): string {
    return offer.conditions.join('\n');
  }

  parsePackageSize(value: string): OfferPackageSize | null {
    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-ZåäöÅÄÖ]+)$/);
    if (!match) return null;
    const amount = Number(match[1].replace(',', '.'));
    return Number.isFinite(amount) && amount > 0
      ? { amount, unit: match[2].toLowerCase() }
      : null;
  }

  parseUnitPrice(value: string): (OfferPrice & { unit: string }) | null {
    const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*kr\s*\/\s*([a-zA-ZåäöÅÄÖ]+)$/i);
    if (!match) return null;
    const amount = Number(match[1].replace(',', '.'));
    return Number.isFinite(amount) && amount > 0
      ? { amount, currency: 'SEK', unit: match[2].toLowerCase() }
      : null;
  }

  get allOffersVerified(): boolean {
    return this.suggestions.length > 0 && this.suggestions.every((offer) => offer.verified);
  }

  get datesAreValid(): boolean {
    const isCalendarDate = (value: string): boolean => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };

    return Boolean(
      isCalendarDate(this.validityStart)
      && isCalendarDate(this.validityEnd)
      && this.validityStart <= this.validityEnd,
    );
  }

  get canPublish(): boolean {
    return Boolean(
      this.runId
      && this.datesAreValid
      && this.allOffersVerified
      && this.completeReview
      && this.suggestions.some((offer) => offer.include)
      && this.suggestions.every((offer) => !offer.include || offer.productName?.trim())
      && this.packageFieldsAreValid,
    );
  }

  get packageFieldsAreValid(): boolean {
    return this.suggestions.every((offer) => !offer.include || (
      (!offer.packageSizeText.trim() || this.parsePackageSize(offer.packageSizeText) !== null)
      && (!offer.unitPriceText.trim() || this.parseUnitPrice(offer.unitPriceText) !== null)));
  }

  async publish(): Promise<void> {
    if (!this.canPublish || this.publishing) return;

    this.error = '';
    this.message = '';
    this.publishing = true;
    try {
      const catalog = await this.offersApi.publish({
        runId: this.runId,
        validityPeriod: { startDate: this.validityStart, endDate: this.validityEnd },
        offers: this.suggestions.map(({ packageSizeText, unitPriceText, ...offer }) => ({
          ...offer,
          packageSize: packageSizeText.trim() ? this.parsePackageSize(packageSizeText) : null,
          unitPrice: unitPriceText.trim() ? this.parseUnitPrice(unitPriceText) : null,
        })),
        completeReview: this.completeReview,
      });
      this.message = 'De granskade erbjudandena är publicerade.';
      this.published.emit(catalog);
      this.runId = '';
    } catch (error) {
      this.error = this.errorMessage(error, 'Kunde inte publicera erbjudandena. Det tidigare reklambladet är kvar.');
    } finally {
      this.publishing = false;
    }
  }

  private resetPreview(): void {
    this.error = '';
    this.message = '';
    this.runId = '';
    this.suggestions = [];
    this.warnings = [];
    this.pageCount = 0;
    this.validityStart = '';
    this.validityEnd = '';
    this.completeReview = false;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.error;
      if (typeof message === 'string') return message;
    }
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }
}
