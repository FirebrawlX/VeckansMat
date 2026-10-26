import { ChangeDetectorRef, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RecipeApiService, ShoppingList, StoreSection } from '../recipe-api.service';
import { PantryApiService } from './pantry-api.service';
import { PantryItem } from './pantry.types';

@Component({
  selector: 'app-pantry-manager',
  imports: [FormsModule],
  templateUrl: './pantry-manager.component.html',
  styleUrl: './pantry-manager.component.css',
})
export class PantryManagerComponent {
  @Input() sections: StoreSection[] = [];
  @Input() currentShoppingList: ShoppingList | null = null;
  @Output() shoppingListChanged = new EventEmitter<void>();

  private readonly api = inject(PantryApiService);
  private readonly shoppingApi = inject(RecipeApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  items: PantryItem[] = [];
  expanded = false;
  draft = { name: '', amount: '', unit: '', sectionCode: '' };
  loading = false;
  saving = false;
  savingId: string | null = null;
  deletingId: string | null = null;
  error = '';
  message = '';

  constructor() {
    this.load();
  }

  private refresh(): void {
    this.changeDetector.markForCheck();
  }

  togglePanel(): void {
    this.expanded = !this.expanded;
    if (this.expanded) this.message = '';
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.items = await this.api.getItems();
    } catch {
      this.error = 'Basvarorna kunde inte hämtas.';
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  async add(): Promise<void> {
    if (!this.draft.name.trim() || this.saving) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    try {
      const item = await this.api.addItem({
        name: this.draft.name.trim(), amount: this.draft.amount.trim(),
        unit: this.draft.unit.trim(), sectionCode: this.draft.sectionCode,
      });
      this.items = [...this.items, item];
      this.draft = { name: '', amount: '', unit: '', sectionCode: '' };
      this.expanded = false;
      const alreadyInList = this.currentShoppingList?.items.some((entry) => this.itemKey(entry.name) === this.itemKey(item.name));
      if (this.currentShoppingList && !alreadyInList) {
        try {
          await this.shoppingApi.addShoppingItem(this.currentShoppingList.id, item);
          this.shoppingListChanged.emit();
          this.message = 'Basvaran är sparad och tillagd i veckans inköpslista.';
        } catch {
          this.message = 'Basvaran är sparad till kommande veckor, men kunde inte läggas till i den öppna listan.';
        }
      } else if (alreadyInList) {
        this.message = 'Basvaran är sparad och finns redan i veckans inköpslista.';
      } else {
        this.message = 'Basvaran är sparad och följer med nästa inköpslista.';
      }
    } catch {
      this.error = 'Basvaran kunde inte sparas. Kontrollera namn och avdelning.';
    } finally {
      this.saving = false;
      this.refresh();
    }
  }

  async save(item: PantryItem): Promise<void> {
    this.savingId = item.id;
    this.error = '';
    this.message = '';
    try {
      const updated = await this.api.updateItem(item.id, {
        name: item.name.trim(), amount: item.amount.trim(),
        unit: item.unit.trim(), sectionCode: item.sectionCode,
      });
      this.items = this.items.map((entry) => entry.id === item.id ? updated : entry);
      this.message = 'Basvaran är uppdaterad för kommande inköpslistor.';
    } catch {
      this.error = 'Ändringen kunde inte sparas. Kontrollera namn och avdelning.';
    } finally {
      this.savingId = null;
      this.refresh();
    }
  }

  async remove(item: PantryItem): Promise<void> {
    this.deletingId = item.id;
    this.error = '';
    this.message = '';
    try {
      await this.api.deleteItem(item.id);
      this.items = this.items.filter((entry) => entry.id !== item.id);
      this.message = 'Basvaran är borttagen.';
    } catch {
      this.error = 'Basvaran kunde inte tas bort. Försök igen.';
    } finally {
      this.deletingId = null;
      this.refresh();
    }
  }

  private itemKey(name: string): string {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');
  }
}
