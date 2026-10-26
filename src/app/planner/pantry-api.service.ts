import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PantryItem, PantryItemDraft } from './pantry.types';

@Injectable({ providedIn: 'root' })
export class PantryApiService {
  private readonly http = inject(HttpClient);

  getItems(): Promise<PantryItem[]> {
    return firstValueFrom(this.http.get<PantryItem[]>('/api/pantry-items', { withCredentials: true }));
  }

  addItem(item: PantryItemDraft): Promise<PantryItem> {
    return firstValueFrom(this.http.post<PantryItem>('/api/pantry-items', item, { withCredentials: true }));
  }

  updateItem(id: string, item: PantryItemDraft): Promise<PantryItem> {
    return firstValueFrom(this.http.patch<PantryItem>(`/api/pantry-items/${encodeURIComponent(id)}`, item, { withCredentials: true }));
  }

  deleteItem(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/pantry-items/${encodeURIComponent(id)}`, { withCredentials: true }));
  }
}
