import { TestBed } from '@angular/core/testing';
import { illustrativeOfferCatalog } from './offer.examples';
import { OfferApiService } from './offer-api.service';
import type { OfferPublishedResponse } from './offer-api.service';
import { OffersPageComponent } from './offers-page.component';
import { RecipeApiService } from '../recipe-api.service';
import { getOfferMenuWeekStart } from '../week-date';

async function createFixture(
  response: OfferPublishedResponse = {
    catalog: illustrativeOfferCatalog,
    publishedAt: Date.now(),
    lastImport: null,
  },
  shoppingListId: string | null = null,
  addShoppingItem: (listId: string, item: { name: string; amount: string; unit: string; isOffer?: boolean }) => Promise<unknown> =
    () => Promise.resolve({}),
  getWeeklyPlan = (weekStart: string) => Promise.resolve({
    weekStart,
    updatedAt: null,
    shoppingListId,
    meals: [],
  }),
) {
  await TestBed.configureTestingModule({
    imports: [OffersPageComponent],
    providers: [
      {
        provide: OfferApiService,
        useValue: { getPublished: () => Promise.resolve(response) },
      },
      {
        provide: RecipeApiService,
        useValue: {
          addShoppingItem,
          getWeeklyPlan,
          getShoppingList: (id: string) => Promise.resolve({
            id,
            title: 'Inköpslista',
            createdAt: 0,
            updatedAt: 0,
            items: [],
          }),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(OffersPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  for (
    let attempts = 0;
    attempts < 10 &&
    (fixture.componentInstance.isLoadingPublished || fixture.componentInstance.isLoadingShoppingList);
    attempts++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(fixture.componentInstance.isLoadingPublished).toBe(false);
  expect(fixture.componentInstance.isLoadingShoppingList).toBe(false);
  fixture.detectChanges();
  return fixture;
}

describe('OffersPageComponent', () => {
  it('replaces its initial empty state with the published catalog', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.hasPublishedOffers).toBe(true);
    expect(element.querySelector('.offers-demo-note')).toBeNull();
    expect(element.querySelector('.offers-empty')).toBeNull();
    expect(element.querySelector('.offers-store-heading h2')?.textContent).toContain(
      'Stora Coop Lund',
    );
    expect(element.querySelectorAll('.offer-department').length).toBeGreaterThan(1);
    expect(element.querySelector('.offer-department h3')?.textContent).toContain('Frukt & grönt');
  });

  it('does not present an uncertain price as a confirmed amount', async () => {
    const fixture = await createFixture();
    const element = fixture.nativeElement as HTMLElement;
    const uncertainOffer = [...element.querySelectorAll('.offer-card')].find((card) =>
      card.textContent?.includes('Dagens erbjudande'),
    );

    expect(uncertainOffer?.querySelector('.offer-price-uncertain')?.textContent).toContain(
      'Pris behöver kontrolleras',
    );
    expect(uncertainOffer?.textContent).toContain('Priset går inte att läsa');
  });

  it('shows offers from the selected store only', async () => {
    const fixture = await createFixture();
    fixture.componentInstance.selectStore('demo-market-malmo');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.offers-store-heading h2')?.textContent).toContain(
      'Exempelbutik Malmö',
    );
    expect(element.querySelectorAll('.offer-card h4')).toHaveLength(2);
    expect(element.textContent).toContain('Körsbärstomater');
    expect(element.textContent).not.toContain('Svenska äpplen');
  });

  it('does not show illustrative offers when published data is unavailable', async () => {
    const fixture = await createFixture({ catalog: null, publishedAt: null, lastImport: null });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.offers-demo-note')).toBeNull();
    expect(element.querySelector('.offers-empty')?.textContent).toContain(
      'Inga importerade erbjudanden',
    );
    expect(element.querySelector('.offer-card')).toBeNull();
  });

  it('disables adding offers until a shopping list exists', async () => {
    const addShoppingItem = () => Promise.resolve({});
    const fixture = await createFixture(undefined, null, addShoppingItem);
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.offer-add-button')];

    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Skapa nästa veckas inköpslista');
  });

  it('adds an offer to the existing list with its offer marker', async () => {
    const calls: { listId: string; item: { name: string; amount: string; unit: string; isOffer?: boolean } }[] = [];
    const planRequests: string[] = [];
    const fixture = await createFixture(
      undefined,
      'weekly-list-id',
      (listId, item) => {
        calls.push({ listId, item });
        return Promise.resolve({});
      },
      (weekStart) => {
        planRequests.push(weekStart);
        return Promise.resolve({
          weekStart,
          updatedAt: null,
          shoppingListId: 'weekly-list-id',
          meals: [],
        });
      },
    );
    const element = fixture.nativeElement as HTMLElement;
    const appleCard = [...element.querySelectorAll<HTMLElement>('.offer-card')].find((card) =>
      card.textContent?.includes('Svenska äpplen'),
    );
    const button = appleCard?.querySelector<HTMLButtonElement>('.offer-add-button');

    expect(button?.disabled).toBe(false);
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toEqual([
      { listId: 'weekly-list-id', item: { name: 'Svenska äpplen', amount: '', unit: '', isOffer: true } },
    ]);
    expect(planRequests).toEqual([getOfferMenuWeekStart()]);
    expect(button?.textContent).toContain('Tillagd');
    expect(button?.disabled).toBe(true);
  });
});
