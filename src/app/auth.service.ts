import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly isLoading = signal(true);
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
      this.error.set('Could not connect to the app server. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async unlock(pin: string): Promise<void> {
    this.error.set('');
    this.isLoading.set(true);
    try {
      await firstValueFrom(
        this.http.post('/api/auth/unlock', { pin }, { withCredentials: true }),
      );
      this.isUnlocked.set(true);
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      this.error.set(
        status === 429
          ? 'Too many attempts. Please wait 15 minutes and try again.'
          : status === 401
            ? 'That PIN is not correct.'
            : status === 503
              ? 'This server does not have a family PIN configured yet. Set FAMILY_PIN as a Cloudflare secret for the deployed app, or in .dev.vars for local development.'
              : status === 0
                ? 'Could not connect to the app server. Please start the API in a second terminal.'
                : 'The app server could not verify the PIN. Please try again.',
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  async lock(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}, { withCredentials: true }));
    } catch {
      // Lock the local interface even if the API cannot be reached.
    } finally {
      this.isUnlocked.set(false);
    }
  }
}
