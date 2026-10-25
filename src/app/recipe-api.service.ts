import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface RecipeIngredient {
  id?: string;
  name: string;
  amount: string;
  unit: string;
  sectionCode?: string;
  position?: number;
}

export interface RecipeDraft {
  title: string;
  description: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number | null;
  foodType: 'meat' | 'fish' | 'vegetarian' | 'vegan' | 'other';
  difficulty: 'easy' | 'medium' | 'hard';
  favorite: boolean;
  kidFriendly: boolean;
  ingredients: RecipeIngredient[];
  steps: string[];
}

export interface Recipe extends Omit<RecipeDraft, 'steps'> {
  id: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
}

export interface RecipeStep {
  id: string;
  instruction: string;
  position: number;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  amount: string;
  unit: string;
  checked: boolean;
  recipeId: string | null;
  position: number;
  sectionCode: string;
}

export interface StoreSection { code: string; name: string; position: number; }

export interface ShoppingList {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  items: ShoppingListItem[];
  sections?: StoreSection[];
}

export interface WeeklyMeal {
  day: number;
  recipeId: string | null;
  recipeTitle: string | null;
}

export interface WeeklyPlan {
  weekStart: string;
  updatedAt: number | null;
  shoppingListId: string | null;
  meals: WeeklyMeal[];
}

@Injectable({ providedIn: 'root' })
export class RecipeApiService {
  private readonly http = inject(HttpClient);

  getRecipes(): Promise<Recipe[]> {
    return firstValueFrom(this.http.get<Recipe[]>('/api/recipes', { withCredentials: true }));
  }

  getStoreSections(): Promise<StoreSection[]> {
    return firstValueFrom(this.http.get<StoreSection[]>('/api/store-sections', { withCredentials: true }));
  }

  saveStoreSections(sections: StoreSection[]): Promise<StoreSection[]> {
    return firstValueFrom(this.http.put<StoreSection[]>('/api/store-sections', { sections }, { withCredentials: true }));
  }

  getRecipe(id: string): Promise<Recipe> {
    return firstValueFrom(this.http.get<Recipe>(`/api/recipes/${encodeURIComponent(id)}`, { withCredentials: true }));
  }

  getWeeklyPlan(weekStart: string): Promise<WeeklyPlan> {
    return firstValueFrom(this.http.get<WeeklyPlan>(`/api/weekly-plan?weekStart=${encodeURIComponent(weekStart)}`, { withCredentials: true }));
  }

  saveWeeklyPlan(weekStart: string, recipeIds: (string | null)[]): Promise<WeeklyPlan> {
    return firstValueFrom(this.http.put<WeeklyPlan>('/api/weekly-plan', { weekStart, recipeIds }, { withCredentials: true }));
  }

  createWeeklyShoppingList(weekStart: string, regenerate = false): Promise<ShoppingList> {
    return firstValueFrom(this.http.post<ShoppingList>('/api/weekly-plan/shopping-list', { weekStart, regenerate }, { withCredentials: true }));
  }

  getShoppingList(id: string): Promise<ShoppingList> {
    return firstValueFrom(this.http.get<ShoppingList>(`/api/shopping-lists/${encodeURIComponent(id)}`, { withCredentials: true }));
  }

  createRecipe(recipe: RecipeDraft): Promise<Recipe> {
    return firstValueFrom(this.http.post<Recipe>('/api/recipes', recipe, { withCredentials: true }));
  }

  updateRecipe(id: string, recipe: RecipeDraft): Promise<Recipe> {
    return firstValueFrom(this.http.put<Recipe>(`/api/recipes/${encodeURIComponent(id)}`, recipe, { withCredentials: true }));
  }

  deleteRecipe(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/recipes/${encodeURIComponent(id)}`, { withCredentials: true }));
  }

  getShoppingLists(): Promise<ShoppingList[]> {
    return firstValueFrom(this.http.get<ShoppingList[]>('/api/shopping-lists', { withCredentials: true }));
  }

  createShoppingList(title: string): Promise<ShoppingList> {
    return firstValueFrom(this.http.post<ShoppingList>('/api/shopping-lists', { title }, { withCredentials: true }));
  }

  renameShoppingList(id: string, title: string): Promise<{ id: string; title: string }> {
    return firstValueFrom(this.http.patch<{ id: string; title: string }>(`/api/shopping-lists/${encodeURIComponent(id)}`, { title }, { withCredentials: true }));
  }

  deleteShoppingList(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/shopping-lists/${encodeURIComponent(id)}`, { withCredentials: true }));
  }

  addShoppingItem(listId: string, item: Pick<ShoppingListItem, 'name' | 'amount' | 'unit'>): Promise<ShoppingListItem> {
    return firstValueFrom(this.http.post<ShoppingListItem>(`/api/shopping-lists/${encodeURIComponent(listId)}/items`, item, { withCredentials: true }));
  }

  addRecipesToShoppingList(listId: string, recipeIds: string[]): Promise<{ added: number }> {
    return firstValueFrom(this.http.post<{ added: number }>(`/api/shopping-lists/${encodeURIComponent(listId)}/from-recipes`, { recipeIds }, { withCredentials: true }));
  }

  updateShoppingItem(id: string, changes: Partial<Pick<ShoppingListItem, 'name' | 'amount' | 'unit' | 'checked' | 'sectionCode'>>): Promise<ShoppingListItem> {
    return firstValueFrom(this.http.patch<ShoppingListItem>(`/api/shopping-list-items/${encodeURIComponent(id)}`, changes, { withCredentials: true }));
  }

  deleteShoppingItem(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/shopping-list-items/${encodeURIComponent(id)}`, { withCredentials: true }));
  }
}
