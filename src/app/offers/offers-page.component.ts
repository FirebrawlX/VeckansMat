import { ChangeDetectorRef, Component, Input, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RecipeApiService } from '../recipe-api.service';
import { OfferApiService } from './offer-api.service';
import type { OfferPublishedResponse } from './offer-api.service';
import { OfferImportComponent } from './offer-import.component';
import type {
  GroceryOffer,
  OfferDateRange,
  OfferField,
  OfferFlyer,
  OfferCatalog,
  OfferPrice,
} from './offer.types';

const DEPARTMENT_ORDER = [
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

interface OfferDepartment {
  name: string;
  offers: GroceryOffer[];
}

@Component({
  selector: 'app-offers-page',
  imports: [DatePipe, FormsModule, OfferImportComponent],
  templateUrl: './offers-page.component.html',
  styleUrl: './offers-page.component.css',
})
export class OffersPageComponent implements OnInit {
  private readonly offersApi = inject(OfferApiService);
  private readonly recipesApi = inject(RecipeApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  @Input() shoppingListId: string | null = null;
  catalog: OfferCatalog = { stores: [], flyers: [], offers: [] };
  isLoadingPublished = true;
  hasPublishedOffers = false;
  importOpen = false;
  loadError = '';
  publishedAt: number | null = null;
  lastImport: OfferPublishedResponse['lastImport'] = null;
  selectedStoreId = '';
  addingOfferIds = new Set<string>();
  addedOfferIds = new Set<string>();
  offerAddErrors: Record<string, string> = {};

  get stores() {
    return this.catalog.stores;
  }

  get selectedStore() {
    return this.catalog.stores.find((store) => store.id === this.selectedStoreId);
  }

  get storeFlyers(): OfferFlyer[] {
    return this.catalog.flyers.filter((flyer) => flyer.storeId === this.selectedStoreId);
  }

  ngOnInit(): void {
    void this.loadPublishedOffers();
  }

  get activeFlyers(): OfferFlyer[] {
    return this.storeFlyers.filter((flyer) => this.isCurrentPeriod(flyer.validityPeriod));
  }

  get groupedOffers(): OfferDepartment[] {
    const activeFlyerIds = new Set(this.activeFlyers.map((flyer) => flyer.id));
    const groups = new Map<string, GroceryOffer[]>();

    for (const offer of this.catalog.offers) {
      if (!activeFlyerIds.has(offer.flyerId)) continue;
      const flyer = this.storeFlyers.find((item) => item.id === offer.flyerId);
      if (!flyer || !this.isOfferCurrent(offer, flyer)) continue;

      const department =
        offer.category.status === 'known' ? offer.category.value : 'Okänd avdelning';
      groups.set(department, [...(groups.get(department) ?? []), offer]);
    }

    return [...groups.entries()]
      .sort(
        ([left], [right]) =>
          this.departmentPosition(left) - this.departmentPosition(right) ||
          left.localeCompare(right, 'sv'),
      )
      .map(([name, offers]) => ({ name, offers }));
  }

  selectStore(storeId: string): void {
    this.selectedStoreId = storeId;
  }

  async addOffer(offer: GroceryOffer): Promise<void> {
    if (
      !this.shoppingListId ||
      offer.productName.status !== 'known' ||
      this.addingOfferIds.has(offer.id) ||
      this.addedOfferIds.has(offer.id)
    ) return;

    this.addingOfferIds.add(offer.id);
    delete this.offerAddErrors[offer.id];
    try {
      const packageSize = offer.packageSize.status === 'known' ? offer.packageSize.value : null;
      await this.recipesApi.addShoppingItem(this.shoppingListId, {
        name: offer.productName.value,
        amount: packageSize ? this.formatNumber(packageSize.amount) : '',
        unit: packageSize?.unit ?? '',
        isOffer: true,
      });
      this.addedOfferIds.add(offer.id);
    } catch {
      this.offerAddErrors[offer.id] = 'Erbjudandet kunde inte läggas till. Försök igen.';
    } finally {
      this.addingOfferIds.delete(offer.id);
      this.changeDetector.markForCheck();
    }
  }

  async onPublished(): Promise<void> {
    this.importOpen = false;
    await this.loadPublishedOffers();
  }

  flyerPeriodLabel(period: OfferField<OfferDateRange>): string {
    if (period.status === 'missing') return 'Giltighetstid saknas';
    if (period.status === 'uncertain') return 'Giltighetstiden är osäker';
    return this.formatDateRange(period.value);
  }

  offerPeriodLabel(offer: GroceryOffer): string {
    const flyer = this.storeFlyers.find((item) => item.id === offer.flyerId);
    if (offer.validityPeriod.status === 'known') {
      return this.expiryLabel(offer.validityPeriod.value);
    }
    if (offer.validityPeriod.status === 'uncertain') return 'Kontrollera giltigheten';
    return flyer
      ? this.expiryLabel(
          flyer.validityPeriod.status === 'known' ? flyer.validityPeriod.value : null,
        )
      : 'Giltighet saknas';
  }

  productName(offer: GroceryOffer): string {
    if (offer.productName.status === 'known') return offer.productName.value;
    if (offer.productName.status === 'uncertain')
      return offer.productName.value ?? 'Produktnamnet är osäkert';
    return 'Produktnamn saknas';
  }

  priceLabel(price: OfferField<OfferPrice>): string {
    if (price.status === 'known') return this.formatPrice(price.value);
    return price.status === 'uncertain' ? 'Pris behöver kontrolleras' : 'Pris saknas';
  }

  priceNote(price: OfferField<OfferPrice>): string {
    return price.status === 'uncertain' ? price.note : '';
  }

  brandLabel(offer: GroceryOffer): string {
    if (offer.brand.status === 'known') return offer.brand.value;
    if (offer.brand.status === 'uncertain') return 'Varumärke osäkert';
    return '';
  }

  packageSizeLabel(offer: GroceryOffer): string {
    if (offer.packageSize.status === 'known') {
      return `${this.formatNumber(offer.packageSize.value.amount)} ${offer.packageSize.value.unit}`;
    }
    if (offer.packageSize.status === 'uncertain') return 'Förpackningsstorlek osäker';
    return '';
  }

  unitPriceLabel(offer: GroceryOffer): string {
    if (offer.unitPrice.status === 'known') {
      return `${this.formatPrice(offer.unitPrice.value)} / ${offer.unitPrice.value.unit}`;
    }
    if (offer.unitPrice.status === 'uncertain') return 'Jämförpris behöver kontrolleras';
    return '';
  }

  conditionLabels(offer: GroceryOffer): string[] {
    if (offer.conditions.status === 'known')
      return offer.conditions.value.map((condition) => condition.text);
    if (offer.conditions.status === 'uncertain') return ['Villkor behöver kontrolleras'];
    return [];
  }

  isEndingSoon(offer: GroceryOffer): boolean {
    const range = this.effectivePeriod(offer);
    if (!range) return false;
    const daysLeft = this.daysUntil(range.endDate);
    return daysLeft >= 0 && daysLeft <= 2;
  }

  private isOfferCurrent(offer: GroceryOffer, flyer: OfferFlyer): boolean {
    if (offer.validityPeriod.status === 'known')
      return this.isCurrentRange(offer.validityPeriod.value);
    if (offer.validityPeriod.status === 'uncertain')
      return this.isCurrentPeriod(flyer.validityPeriod);
    return this.isCurrentPeriod(flyer.validityPeriod);
  }

  private isCurrentPeriod(period: OfferField<OfferDateRange>): boolean {
    return period.status === 'known' && this.isCurrentRange(period.value);
  }

  private isCurrentRange(range: OfferDateRange): boolean {
    const today = this.startOfToday().getTime();
    return this.dateValue(range.startDate) <= today && this.dateValue(range.endDate) >= today;
  }

  private effectivePeriod(offer: GroceryOffer): OfferDateRange | null {
    if (offer.validityPeriod.status === 'known') return offer.validityPeriod.value;
    if (offer.validityPeriod.status === 'uncertain') return null;
    const flyer = this.storeFlyers.find((item) => item.id === offer.flyerId);
    return flyer?.validityPeriod.status === 'known' ? flyer.validityPeriod.value : null;
  }

  private expiryLabel(range: OfferDateRange | null): string {
    if (!range) return 'Giltighet saknas';
    const daysLeft = this.daysUntil(range.endDate);
    if (daysLeft < 0) return 'Erbjudandet har gått ut';
    if (daysLeft === 0) return 'Sista dagen idag';
    if (daysLeft === 1) return 'Går ut imorgon';
    if (daysLeft <= 2) return `Går ut om ${daysLeft} dagar`;
    return `Gäller till ${this.formatDate(range.endDate)}`;
  }

  private daysUntil(date: string): number {
    return Math.round((this.dateValue(date) - this.startOfToday().getTime()) / 86_400_000);
  }

  private dateValue(date: string): number {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  private startOfToday(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  private formatDateRange(range: OfferDateRange): string {
    return `${this.formatDate(range.startDate)}–${this.formatDate(range.endDate)}`;
  }

  private formatDate(date: string): string {
    return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(
      this.dateValueAsDate(date),
    );
  }

  private dateValueAsDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private formatPrice(price: OfferPrice): string {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: price.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price.amount);
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value);
  }

  private departmentPosition(department: string): number {
    const position = DEPARTMENT_ORDER.indexOf(department);
    return position === -1 ? DEPARTMENT_ORDER.length : position;
  }

  private async loadPublishedOffers(): Promise<void> {
    this.isLoadingPublished = true;
    try {
      const response = await this.offersApi.getPublished();
      this.lastImport = response.lastImport;
      this.publishedAt = response.publishedAt;
      this.loadError = '';
      if (response.catalog) {
        this.catalog = response.catalog;
        this.hasPublishedOffers = true;
        this.selectedStoreId = response.catalog.stores[0]?.id ?? '';
      } else {
        this.catalog = { stores: [], flyers: [], offers: [] };
        this.hasPublishedOffers = false;
        this.selectedStoreId = '';
      }
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? error.error?.error : null;
      this.loadError =
        typeof message === 'string'
          ? message
          : 'Importerade erbjudanden kunde inte läsas. Försök igen.';
      this.catalog = { stores: [], flyers: [], offers: [] };
      this.hasPublishedOffers = false;
      this.selectedStoreId = '';
    } finally {
      this.isLoadingPublished = false;
      this.changeDetector.markForCheck();
    }
  }
}
