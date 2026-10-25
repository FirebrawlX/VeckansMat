import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpInterceptorFn, provideHttpClient, withInterceptors } from '@angular/common/http';
import { timeout } from 'rxjs';
import { routes } from './app.routes';

const requestTimeout: HttpInterceptorFn = (request, next) => next(request).pipe(
  timeout({ each: request.url.endsWith('/api/auth/session') ? 5000 : 8000 }),
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([requestTimeout]))
  ]
};
