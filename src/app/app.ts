import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from './auth.service';

@Component({
  imports: [...HlmButtonImports, FormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  readonly auth = inject(AuthService);
  pin = '';

  submitPin(): void {
    void this.auth.unlock(this.pin);
    this.pin = '';
  }

  lockApp(): void {
    void this.auth.lock();
  }
}
