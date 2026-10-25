import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly isLoading = signal(true);
  readonly isUnlocking = signal(false);
  readonly isUnlocked = signal(false);
  readonly error = signal('');

  constructor() {
    void this.checkSession();
  }

  async checkSession(): Promise<void> {
    this.isLoading.set(true);
    try {
      const result = await firstValueFrom(
        this.http.get<{ authenticated: boolean }>('/api/auth/session', { withCredentials: true }),
      );
      this.isUnlocked.set(result.authenticated);
    } catch {
      this.isUnlocked.set(false);
      this.error.set('Kunde inte ansluta till servern. Försök igen.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async unlock(pin: string): Promise<void> {
    this.error.set('');
    this.isUnlocking.set(true);
    try {
      await firstValueFrom(
        this.http.post('/api/auth/unlock', { pin }, { withCredentials: true }),
      );
      this.isUnlocked.set(true);
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      const timedOut = (error as { name?: string }).name === 'TimeoutError';
      this.error.set(
        timedOut
          ? 'Servern svarar inte just nu. Försök igen om en liten stund.'
          : status === 429
          ? 'För många försök. Vänta 15 minuter och försök igen.'
          : status === 401
            ? 'PIN-koden stämmer inte.'
            : status === 503
              ? 'Familjens PIN-kod är inte inställd på servern ännu.'
              : status === 0
                ? 'Kunde inte ansluta till servern. Starta API-servern och försök igen.'
                : 'Servern kunde inte verifiera PIN-koden. Försök igen.',
      );
    } finally {
      this.isUnlocking.set(false);
    }
  }

  async lock(): Promise<void> {
    this.isUnlocked.set(false);
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}, { withCredentials: true }));
    } catch {
      // Lock the local interface even if the API cannot be reached.
    }
  }
}
