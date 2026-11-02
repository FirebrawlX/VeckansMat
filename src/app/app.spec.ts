import { TestBed } from '@angular/core/testing';
import { App, canCreateShoppingListForWeek, getShoppingWeekStart, isPastShoppingWeek } from './app';

describe('App', () => {
  it('uses the following Monday as the shopping week on Saturday and Sunday', () => {
    expect(getShoppingWeekStart(new Date(2026, 9, 31))).toBe('2026-11-02');
    expect(getShoppingWeekStart(new Date(2026, 10, 1))).toBe('2026-11-02');
  });

  it('keeps the current Monday-to-Sunday week on weekdays', () => {
    expect(getShoppingWeekStart(new Date(2026, 9, 30))).toBe('2026-10-26');
    expect(getShoppingWeekStart(new Date(2026, 10, 2))).toBe('2026-11-02');
  });

  it('only allows list creation for the upcoming week on weekends', () => {
    const sunday = new Date(2026, 10, 1);
    expect(canCreateShoppingListForWeek(sunday, '2026-11-02')).toBe(true);
    expect(canCreateShoppingListForWeek(sunday, '2026-10-26')).toBe(false);
    expect(canCreateShoppingListForWeek(new Date(2026, 10, 2), '2026-10-26')).toBe(true);
  });

  it('identifies shopping lists from weeks before the current calendar week', () => {
    expect(isPastShoppingWeek(new Date(2026, 10, 2), '2026-10-26')).toBe(true);
    expect(isPastShoppingWeek(new Date(2026, 10, 2), '2026-11-02')).toBe(false);
    expect(isPastShoppingWeek(new Date(2026, 10, 1), '2026-10-19')).toBe(true);
    expect(isPastShoppingWeek(new Date(2026, 10, 1), '2026-10-26')).toBe(false);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Swedish unlock title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Välkommen hem.');
  });
});
