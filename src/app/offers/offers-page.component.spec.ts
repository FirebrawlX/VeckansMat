import { TestBed } from '@angular/core/testing';
import { illustrativeOfferCatalog } from './offer.examples';
import { OfferApiService } from './offer-api.service';
import type { OfferPublishedResponse } from './offer-api.service';
import { OffersPageComponent } from './offers-page.component';

async function createFixture(
  response: OfferPublishedResponse = {
    catalog: illustrativeOfferCatalog,
    publishedAt: Date.now(),
    lastImport: null,
  },
) {
  await TestBed.configureTestingModule({
    imports: [OffersPageComponent],
    providers: [
      {
        provide: OfferApiService,
        useValue: { getPublished: () => Promise.resolve(response) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(OffersPageComponent);
  fixture.detectChanges();
  await fixture.whenStable();
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
});
