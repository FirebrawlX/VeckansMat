import { TestBed } from '@angular/core/testing';
import { OfferApiService } from './offer-api.service';
import { OffersPageComponent } from './offers-page.component';

describe('OffersPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OffersPageComponent],
      providers: [{
        provide: OfferApiService,
        useValue: { getPublished: () => Promise.resolve({ catalog: null, publishedAt: null, lastImport: null }) },
      }],
    }).compileComponents();
  });

  it('displays demo offers grouped by department with validity periods', () => {
    const fixture = TestBed.createComponent(OffersPageComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h2')?.textContent).toContain('Stora Coop Lund');
    expect(element.querySelector('.offers-validity')?.textContent).toContain('Reklamblad');
    expect(element.querySelectorAll('.offer-department').length).toBeGreaterThan(1);
    expect(element.querySelector('.offer-department h3')?.textContent).toContain('Frukt & grönt');
    expect(element.querySelector('.offer-expiry')?.textContent).toMatch(/Går ut|Sista dagen/);
    expect(element.querySelector('.offers-demo-note')?.textContent).toContain('påhittade');
  });

  it('does not present an uncertain price as a confirmed amount', () => {
    const fixture = TestBed.createComponent(OffersPageComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const uncertainOffer = [...element.querySelectorAll('.offer-card')]
      .find((card) => card.textContent?.includes('Dagens erbjudande'));

    expect(uncertainOffer?.querySelector('.offer-price-uncertain')?.textContent).toContain('Pris behöver kontrolleras');
    expect(uncertainOffer?.textContent).toContain('Priset går inte att läsa');
  });

  it('shows offers from the selected store only', () => {
    const fixture = TestBed.createComponent(OffersPageComponent);
    fixture.componentInstance.selectStore('demo-market-malmo');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.offers-store-heading h2')?.textContent).toContain('Exempelbutik Malmö');
    expect(element.querySelectorAll('.offer-card h4')).toHaveLength(2);
    expect(element.textContent).toContain('Körsbärstomater');
    expect(element.textContent).not.toContain('Svenska äpplen');
  });
});
