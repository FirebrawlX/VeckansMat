import { Component } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

@Component({
  imports: [...HlmButtonImports],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {}
