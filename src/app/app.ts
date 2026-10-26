import { ChangeDetectorRef, Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from './auth.service';
import { RecipeApiService, Recipe, RecipeDraft, RecipeIngredient, ShoppingList, ShoppingListItem, StoreSection, WeeklyPlan } from './recipe-api.service';
import { PantryManagerComponent } from './planner/pantry-manager.component';

const DAY_NAMES = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
type RecipeForm = RecipeDraft;
type MealType = 'dinner' | 'lunch';
type PlanEntry = { recipeId: string; type: MealType; eaten: boolean };

function withDeadline<T>(request: Promise<T>, milliseconds: number): Promise<T> {
  let timer: number | undefined;
  const deadline = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => {
      const error = new Error('The request took too long.');
      error.name = 'TimeoutError';
      reject(error);
    }, milliseconds);
  });
  return Promise.race([request, deadline]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function emptyRecipe(): RecipeForm {
  return {
    title: '', mealKind: 'dinner', description: '', prepMinutes: null, cookMinutes: null, servings: null,
    foodType: 'other', difficulty: 'easy', favorite: false, kidFriendly: false,
    ingredients: [{ name: '', amount: '', unit: '', sectionCode: '' }], steps: [''],
  };
}

@Component({
  imports: [...HlmButtonImports, FormsModule, PantryManagerComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly dayNames = DAY_NAMES;
  readonly shortDayNames = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
  private readonly recipesApi = inject(RecipeApiService);
  pin = '';
  recipes: Recipe[] = [];
  recipesLoading = false;
  recipesError = '';
  screen: 'week' | 'shopping' | 'collection' | 'recipe-detail' | 'new-recipe' | 'saved' = 'week';
  weekStart = this.getCurrentWeekStart();
  weeklyPlan: WeeklyPlan | null = null;
  planDraft: PlanEntry[] = [];
  savedRecipeIds: PlanEntry[] = [];
  planAccepted = false;
  planUnlockOpen = false;
  planUnlockPin = '';
  planUnlocking = false;
  planEditPin = '';
  eatenUpdatingIndex: number | null = null;
  preferences = { dinners: 7, chicken: 1, meat: 1, fish: 1, vegetarian: 1, easy: 3, kidFriendly: 2, favorites: 2, lunch: 0 };
  shoppingList: ShoppingList | null = null;
  weekLoading = false;
  private weekLoadGeneration = 0;
  planSaving = false;
  listGenerating = false;
  weekError = '';
  planMessage = '';
  recipeForm = emptyRecipe();
  saving = false;
  saveError = '';
  savedTitle = '';
  selectedRecipeDetail: Recipe | null = null;
  editingRecipeId: string | null = null;
  shoppingItemDraft = { name: '', amount: '', unit: '' };
  shoppingItemError = '';
  shoppingItemMessage = '';
  shoppingItemSaving = false;
  editingShoppingItemId: string | null = null;
  editingShoppingItemDraft = { name: '', amount: '', unit: '' };
  filter = '';
  storeSections: StoreSection[] = [{ code: 'A', name: 'Frukt & grönt', position: 0 }];
  sectionDraft: StoreSection[] = [];
  sectionSaving = false;
  sectionError = '';
  sectionMessage = '';
  sectionSettingsOpen = false;
  deletingRecipeId: string | null = null;
  deleteConfirmationRecipeId: string | null = null;
  deleteRecipePin = '';
  recipeEditPin = '';
  recipeEditPinOpen = false;
  recipeUnlocking = false;
  confirmingRecipeId: string | null = null;
  deletingShoppingItemId: string | null = null;
  savingShoppingItemId: string | null = null;
  savingItemSectionId: string | null = null;
  editingSectionItemId: string | null = null;
  ingredientSectionOpenIndex: number | null = null;

  constructor() {
    effect(() => {
      if (this.auth.isUnlocked()) void this.loadAppData();
    });
  }

  private refreshView(): void {
    this.changeDetector.markForCheck();
  }

  get isPlanDirty(): boolean {
    return JSON.stringify(this.planDraft.map(({ recipeId, type }) => ({ recipeId, type }))) !== JSON.stringify(this.savedRecipeIds.map(({ recipeId, type }) => ({ recipeId, type })));
  }

  get selectedDinnerCount(): number {
    return this.planDraft.length;
  }

  get eatenMealCount(): number {
    return this.planDraft.filter((entry) => entry.eaten).length;
  }

  get weekRangeLabel(): string {
    const start = this.parseWeekStart();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const format = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'long' });
    return sameMonth
      ? `${start.getDate()}–${format.format(end)}`
      : `${format.format(start)}–${format.format(end)}`;
  }

  get weekNumber(): number {
    const date = this.parseWeekStart();
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const firstThursday = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  }

  get groupedShoppingItems(): { id: string; title: string; items: ShoppingListItem[] }[] {
    if (!this.shoppingList) return [];
    const groups = new Map<string, ShoppingListItem[]>();
    for (const item of this.shoppingList.items) {
      const code = item.sectionCode || '?';
      groups.set(code, [...(groups.get(code) ?? []), item]);
    }
    return [...groups.keys()].sort((a, b) => a === '?' ? 1 : b === '?' ? -1 : (this.storeSections.find((s) => s.code === a)?.position ?? 999) - (this.storeSections.find((s) => s.code === b)?.position ?? 999)).map((id) => ({ id, title: id === '?' ? 'Oplacerade' : this.storeSections.find((s) => s.code === id)?.name ?? 'Avdelning saknas', items: groups.get(id)!.sort((a,b) => a.name.localeCompare(b.name, 'sv')) }));
  }

  get checkedItemCount(): number {
    return this.shoppingList?.items.filter((item) => item.checked).length ?? 0;
  }

  get shoppingProgress(): number {
    const total = this.shoppingList?.items.length ?? 0;
    return total ? Math.round((this.checkedItemCount / total) * 100) : 0;
  }

  private getCurrentWeekStart(): string {
    const date = new Date();
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return this.dateToKey(date);
  }

  private dateToKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private parseWeekStart(): Date {
    const [year, month, day] = this.weekStart.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  async loadAppData(): Promise<void> {
    await Promise.all([this.loadRecipes(), this.loadWeek(), this.loadStoreSections()]);
  }

  async loadStoreSections(): Promise<void> { try { this.storeSections = await this.recipesApi.getStoreSections(); this.sectionDraft = this.storeSections.map((section) => ({ ...section })); } catch { this.sectionError = 'Avdelningarna kunde inte hämtas.'; } finally { this.refreshView(); } }

  async refreshShoppingListData(): Promise<void> {
    if (!this.shoppingList) return;
    try {
      this.shoppingList = await this.recipesApi.getShoppingList(this.shoppingList.id);
    } catch {
      this.shoppingItemError = 'Veckans inköpslista kunde inte uppdateras just nu.';
    } finally {
      this.refreshView();
    }
  }
  addStoreSection(): void { const used = new Set(this.sectionDraft.map((s) => s.code)); const code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((letter) => !used.has(letter)); if (code) this.sectionDraft.push({ code, name: '', position: this.sectionDraft.length }); }
  moveStoreSection(index: number, offset: number): void { const target = index + offset; if (target < 0 || target >= this.sectionDraft.length) return; [this.sectionDraft[index], this.sectionDraft[target]] = [this.sectionDraft[target], this.sectionDraft[index]]; }
  async saveStoreSections(): Promise<void> { this.sectionSaving = true; this.sectionError = ''; this.sectionMessage = ''; try { this.storeSections = await this.recipesApi.saveStoreSections(this.sectionDraft.map((s, position) => ({ ...s, name: s.name.trim(), position }))); this.sectionDraft = this.storeSections.map((s) => ({ ...s })); this.sectionMessage = 'Butiksavdelningarna är sparade.'; } catch { this.sectionError = 'Avdelningarna kunde inte sparas. Kontrollera namn och unika bokstäver. Flytta först varor och ingredienser från en avdelning du vill ta bort.'; } finally { this.sectionSaving = false; this.refreshView(); } }

  async loadWeek(): Promise<void> {
    const requestId = ++this.weekLoadGeneration;
    this.weekLoading = true;
    this.weekError = '';
    this.refreshView();
    try {
      const { plan, shoppingList } = await withDeadline((async () => {
        const plan = await this.recipesApi.getWeeklyPlan(this.weekStart);
        const shoppingList = plan.shoppingListId ? await this.recipesApi.getShoppingList(plan.shoppingListId) : null;
        return { plan, shoppingList };
      })(), 9000);
      if (requestId !== this.weekLoadGeneration) return;
      this.weeklyPlan = plan;
      this.planDraft = plan.meals.filter((meal) => meal.recipeId).map((meal) => ({ recipeId: meal.recipeId!, type: meal.type ?? 'dinner', eaten: meal.eaten === true }));
      this.savedRecipeIds = this.planDraft.map((meal) => ({ ...meal }));
      this.planAccepted = plan.updatedAt !== null && this.planDraft.length > 0;
      this.shoppingList = shoppingList;
    } catch (error) {
      if (requestId !== this.weekLoadGeneration) return;
      this.weekError = (error as { name?: string }).name === 'TimeoutError'
        ? 'Servern svarar inte. Veckan kunde inte hämtas. Försök igen.'
        : 'Veckans plan kunde inte hämtas. Försök igen.';
    } finally {
      if (requestId === this.weekLoadGeneration) this.weekLoading = false;
      this.refreshView();
    }
  }

  shiftWeek(offset: number): void {
    if (this.isPlanDirty && !window.confirm('Du har osparade ändringar. Vill du lämna veckan ändå?')) return;
    const next = this.parseWeekStart();
    next.setDate(next.getDate() + offset * 7);
    this.weekStart = this.dateToKey(next);
    this.planEditPin = '';
    this.cancelPlanUnlock();
    this.planMessage = '';
    void this.loadWeek();
  }

  dayDate(day: number): string {
    const date = this.parseWeekStart();
    date.setDate(date.getDate() + day);
    return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(date);
  }

  async savePlan(): Promise<void> {
    if (!this.isPlanDirty) {
      this.planAccepted = true;
      this.planEditPin = '';
      this.planUnlockOpen = false;
      this.planUnlockPin = '';
      this.planMessage = 'Planen är fortsatt godkänd.';
      this.refreshView();
      return;
    }
    this.planSaving = true;
    this.weekError = '';
    this.planMessage = '';
    try {
      this.weeklyPlan = await this.recipesApi.saveWeeklyPlan(this.weekStart, this.planDraft, this.planEditPin || undefined);
      this.savedRecipeIds = this.planDraft.map((meal) => ({ ...meal }));
      this.planAccepted = true;
      this.planEditPin = '';
      this.planUnlockOpen = false;
      this.planUnlockPin = '';
      this.shoppingList = null;
      this.planMessage = 'Veckans förslag är godkända.';
    } catch {
      this.weekError = 'Veckans val kunde inte sparas. Försök igen.';
    } finally {
      this.planSaving = false;
      this.refreshView();
    }
  }

  async unlockPlanEditing(): Promise<void> {
    if (!/^\d{8,12}$/.test(this.planUnlockPin) || this.planUnlocking) return;
    this.planUnlocking = true;
    this.weekError = '';
    try {
      await this.recipesApi.unlockWeeklyPlan(this.planUnlockPin);
      this.planEditPin = this.planUnlockPin;
      this.planUnlockPin = '';
      this.planUnlockOpen = false;
      this.planAccepted = false;
      this.planMessage = 'Planen är upplåst för ändringar.';
    } catch {
      this.weekError = 'PIN-koden kunde inte godkännas. Kontrollera den och försök igen.';
    } finally {
      this.planUnlocking = false;
      this.refreshView();
    }
  }

  cancelPlanUnlock(): void {
    this.planUnlockOpen = false;
    this.planUnlockPin = '';
  }

  async cancelPlanEditing(): Promise<void> {
    this.planDraft = this.savedRecipeIds.map((entry) => ({ ...entry }));
    this.planAccepted = true;
    this.planEditPin = '';
    this.planUnlockOpen = false;
    this.planUnlockPin = '';
    this.planMessage = '';
    this.weekError = '';
    if (this.weeklyPlan?.shoppingListId) {
      try {
        this.shoppingList = await this.recipesApi.getShoppingList(this.weeklyPlan.shoppingListId);
      } catch {
        this.shoppingList = null;
      }
    }
    this.refreshView();
  }

  randomizeWeek(): void {
    if (!this.recipes.length) return;
    const picked: PlanEntry[] = [];
    const used = new Set<string>();
    const choose = (predicate: (recipe: Recipe) => boolean, type: MealType, score: (recipe: Recipe) => number = () => 0): boolean => {
      const candidates = this.recipes.filter((recipe) => !used.has(recipe.id) && predicate(recipe));
      if (!candidates.length) return false;
      const topScore = Math.max(...candidates.map(score));
      const bestCandidates = candidates.filter((recipe) => score(recipe) === topScore);
      const recipe = bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
      used.add(recipe.id);
      picked.push({ recipeId: recipe.id, type, eaten: false });
      return true;
    };
    const categoryNeeds: [Recipe['foodType'][], number][] = [
      [['chicken'], this.preferences.chicken], [['meat'], this.preferences.meat], [['fish'], this.preferences.fish], [['vegetarian', 'vegan'], this.preferences.vegetarian],
    ];
    const dinnersAlready = () => picked.filter((entry) => entry.type === 'dinner').length;
    const easyAlready = () => picked.filter((entry) => entry.type === 'dinner' && this.recipeFor(entry)?.difficulty === 'easy').length;
    const kidAlready = () => picked.filter((entry) => entry.type === 'dinner' && this.recipeFor(entry)?.kidFriendly).length;
    const favoriteAlready = () => picked.filter((entry) => this.recipeFor(entry)?.favorite).length;
    const metadataScore = (recipe: Recipe) => Number(recipe.difficulty === 'easy' && easyAlready() < this.preferences.easy) + Number(recipe.kidFriendly && kidAlready() < this.preferences.kidFriendly) + Number(recipe.favorite && favoriteAlready() < this.preferences.favorites);
    for (const [types, count] of categoryNeeds) for (let i = 0; i < count && dinnersAlready() < this.preferences.dinners; i++) choose((recipe) => recipe.mealKind === 'dinner' && types.includes(recipe.foodType), 'dinner', metadataScore);
    while (dinnersAlready() < this.preferences.dinners && choose((recipe) => recipe.mealKind === 'dinner', 'dinner', metadataScore)) { /* fill requested dinner count */ }
    for (let i = 0; i < this.preferences.lunch; i++) choose((recipe) => recipe.mealKind === 'lunch', 'lunch');
    while (easyAlready() < this.preferences.easy && dinnersAlready() < this.preferences.dinners && choose((recipe) => recipe.mealKind === 'dinner' && recipe.difficulty === 'easy', 'dinner', metadataScore)) { /* meet overlapping metadata preference */ }
    while (kidAlready() < this.preferences.kidFriendly && dinnersAlready() < this.preferences.dinners && choose((recipe) => recipe.mealKind === 'dinner' && recipe.kidFriendly, 'dinner', metadataScore)) { /* meet overlapping metadata preference */ }
    this.planDraft = picked;
    this.planAccepted = false;
    this.shoppingList = null;
    this.planMessage = '';
    this.weekError = '';
  }

  clearWeek(): void {
    this.planDraft = [];
    this.planAccepted = false;
    this.shoppingList = null;
    this.planMessage = '';
  }

  async generateShoppingList(): Promise<void> {
    if (this.isPlanDirty) {
      this.weekError = 'Spara veckans middagar innan du skapar inköpslistan.';
      return;
    }
    this.listGenerating = true;
    this.weekError = '';
    try {
      this.shoppingList = await this.recipesApi.createWeeklyShoppingList(this.weekStart);
      this.weeklyPlan = { ...this.weeklyPlan!, shoppingListId: this.shoppingList.id };
      this.screen = 'shopping';
    } catch {
      this.weekError = 'Inköpslistan kunde inte skapas. Välj minst en middag och försök igen.';
    } finally {
      this.listGenerating = false;
      this.refreshView();
    }
  }

  async toggleShoppingItem(item: ShoppingListItem): Promise<void> {
    if (!this.shoppingList) return;
    const checked = !item.checked;
    this.shoppingList = { ...this.shoppingList, items: this.shoppingList.items.map((entry) => entry.id === item.id ? { ...entry, checked } : entry) };
    try {
      await this.recipesApi.updateShoppingItem(item.id, { checked });
    } catch {
      this.shoppingList = { ...this.shoppingList, items: this.shoppingList.items.map((entry) => entry.id === item.id ? { ...entry, checked: item.checked } : entry) };
      this.weekError = 'Ändringen kunde inte sparas. Kontrollera anslutningen.';
    } finally {
      this.refreshView();
    }
  }

  recipeFor(entry: PlanEntry): Recipe | undefined {
    return this.recipes.find((recipe) => recipe.id === entry.recipeId);
  }

  adjustPreference(key: keyof typeof this.preferences, amount: number): void {
    const maximum = key === 'dinners' ? 14 : 7;
    this.preferences[key] = Math.max(0, Math.min(maximum, this.preferences[key] + amount));
  }

  removePlanEntry(index: number): void {
    this.planDraft.splice(index, 1);
    this.shoppingList = null;
    this.planMessage = '';
  }

  async toggleMealEaten(index: number): Promise<void> {
    const entry = this.planDraft[index];
    if (!entry || !this.planAccepted || this.eatenUpdatingIndex !== null) return;
    const previous = entry.eaten;
    entry.eaten = !previous;
    this.eatenUpdatingIndex = index;
    this.weekError = '';
    this.refreshView();
    try {
      await this.recipesApi.setWeeklyMealEaten(this.weekStart, index, entry.eaten);
      this.savedRecipeIds[index] = { ...entry };
    } catch {
      entry.eaten = previous;
      this.weekError = 'Avbockningen kunde inte sparas. Försök igen.';
    } finally {
      this.eatenUpdatingIndex = null;
      this.refreshView();
    }
  }

  togglePlanEntryType(index: number): void {
    this.randomizeEntry(index);
  }

  randomizeEntry(index: number): void {
    const entry = this.planDraft[index];
    if (!entry) return;
    const candidates = this.recipes.filter((recipe) => recipe.mealKind === entry.type && !this.planDraft.some((item, itemIndex) => itemIndex !== index && item.recipeId === recipe.id));
    if (!candidates.length) {
      this.weekError = `Inga fler ${entry.type === 'lunch' ? 'lunchrecept' : 'middagsrecept'} att föreslå.`;
      return;
    }
    const replacement = candidates[Math.floor(Math.random() * candidates.length)];
    this.planDraft[index] = { recipeId: replacement.id, type: replacement.mealKind, eaten: false };
    this.shoppingList = null;
    this.planMessage = '';
    this.weekError = '';
  }

  addLunchSuggestion(): void {
    const candidate = this.recipes.filter((recipe) => recipe.mealKind === 'lunch' && !this.planDraft.some((entry) => entry.recipeId === recipe.id));
    if (!candidate.length) {
      this.weekError = 'Lägg till fler lunchrecept i kokboken för att kunna välja en lunch.';
      return;
    }
    const recipe = candidate[Math.floor(Math.random() * candidate.length)];
    this.planDraft.push({ recipeId: recipe.id, type: 'lunch', eaten: false });
    this.shoppingList = null;
    this.planMessage = '';
    this.weekError = '';
  }

  get filteredRecipes(): Recipe[] {
    const query = this.filter.trim().toLocaleLowerCase('sv');
    return this.recipes.filter((recipe) => recipe.title.toLocaleLowerCase('sv').includes(query));
  }

  async loadRecipes(): Promise<void> {
    this.recipesLoading = true;
    this.recipesError = '';
    this.refreshView();
    try {
      this.recipes = await this.recipesApi.getRecipes();
    } catch {
      this.recipesError = 'Kunde inte hämta recepten. Kontrollera anslutningen och försök igen.';
    } finally {
      this.recipesLoading = false;
      this.refreshView();
    }
  }

  submitPin(): void {
    void this.auth.unlock(this.pin);
    this.pin = '';
  }

  lockApp(): void {
    void this.auth.lock();
  }

  startRecipe(): void {
    this.editingRecipeId = null;
    this.recipeForm = emptyRecipe();
    this.saveError = '';
    this.screen = 'new-recipe';
  }

  openRecipe(recipe: Recipe): void {
    this.selectedRecipeDetail = recipe;
    this.screen = 'recipe-detail';
  }

  editRecipe(recipe: Recipe): void {
    this.editingRecipeId = recipe.id;
    this.recipeForm = {
      title: recipe.title, description: recipe.description, prepMinutes: recipe.prepMinutes,
      mealKind: recipe.mealKind,
      cookMinutes: recipe.cookMinutes, servings: recipe.servings, foodType: recipe.foodType,
      difficulty: recipe.difficulty, favorite: recipe.favorite, kidFriendly: recipe.kidFriendly,
      ingredients: recipe.ingredients.map(({ name, amount, unit, sectionCode }) => ({ name, amount, unit, sectionCode })),
      steps: recipe.steps.map((step) => step.instruction),
    };
    this.saveError = '';
    this.screen = 'new-recipe';
  }

  async confirmRecipe(recipe: Recipe): Promise<void> {
    if (recipe.confirmed || this.confirmingRecipeId) return;
    this.confirmingRecipeId = recipe.id;
    this.recipesError = '';
    try {
      const updated = await this.recipesApi.setRecipeConfirmation(recipe.id, true);
      this.updateRecipe(updated);
    } catch {
      this.recipesError = 'Receptet kunde inte markeras som kontrollerat. Försök igen.';
    } finally {
      this.confirmingRecipeId = null;
      this.refreshView();
    }
  }

  requestRecipeEdit(recipe: Recipe): void {
    this.recipesError = '';
    this.recipeEditPin = '';
    this.recipeEditPinOpen = recipe.confirmed;
    if (!recipe.confirmed) this.editRecipe(recipe);
  }

  cancelRecipeEditUnlock(): void {
    this.recipeEditPinOpen = false;
    this.recipeEditPin = '';
  }

  async unlockRecipeEditing(recipe: Recipe): Promise<void> {
    if (!/^\d{8,12}$/.test(this.recipeEditPin) || this.recipeUnlocking) return;
    this.recipeUnlocking = true;
    this.recipesError = '';
    try {
      const unlocked = await this.recipesApi.setRecipeConfirmation(recipe.id, false, this.recipeEditPin);
      this.updateRecipe(unlocked);
      this.cancelRecipeEditUnlock();
      this.editRecipe(unlocked);
    } catch {
      this.recipesError = 'Receptet kunde inte låsas upp. Kontrollera PIN-koden och försök igen.';
    } finally {
      this.recipeUnlocking = false;
      this.refreshView();
    }
  }

  private updateRecipe(updated: Recipe): void {
    this.recipes = this.recipes.map((recipe) => recipe.id === updated.id ? updated : recipe);
    if (this.selectedRecipeDetail?.id === updated.id) this.selectedRecipeDetail = updated;
  }

  requestRecipeDeletion(recipe: Recipe): void {
    this.deleteConfirmationRecipeId = recipe.id;
    this.deleteRecipePin = '';
    this.recipesError = '';
  }

  cancelRecipeDeletion(): void {
    this.deleteConfirmationRecipeId = null;
    this.deleteRecipePin = '';
  }

  async deleteRecipe(recipe: Recipe): Promise<void> {
    if (this.deleteConfirmationRecipeId !== recipe.id || !/^\d{8,12}$/.test(this.deleteRecipePin)) return;
    this.deletingRecipeId = recipe.id;
    try {
      await this.recipesApi.deleteRecipe(recipe.id, this.deleteRecipePin);
      this.recipes = this.recipes.filter((entry) => entry.id !== recipe.id);
      this.selectedRecipeDetail = null;
      this.planDraft = this.planDraft.filter((entry) => entry.recipeId !== recipe.id);
      this.cancelRecipeDeletion();
      this.screen = 'collection';
      this.refreshView();
      await this.loadWeek();
    } catch {
      this.recipesError = 'Receptet kunde inte tas bort. Kontrollera PIN-koden och försök igen.';
    } finally {
      this.deletingRecipeId = null;
      this.refreshView();
    }
  }

  addIngredient(): void {
    this.recipeForm.ingredients.push({ name: '', amount: '', unit: '' });
  }

  removeIngredient(index: number): void {
    if (this.recipeForm.ingredients.length > 1) this.recipeForm.ingredients.splice(index, 1);
    if (this.ingredientSectionOpenIndex === index) this.ingredientSectionOpenIndex = null;
    else if (this.ingredientSectionOpenIndex !== null && this.ingredientSectionOpenIndex > index) this.ingredientSectionOpenIndex -= 1;
  }

  addStep(): void {
    this.recipeForm.steps.push('');
  }

  removeStep(index: number): void {
    if (this.recipeForm.steps.length > 1) this.recipeForm.steps.splice(index, 1);
  }

  foodLabel(type: Recipe['foodType']): string {
    return ({ meat: 'Kött', chicken: 'Kyckling', fish: 'Fisk', vegetarian: 'Vegetariskt', vegan: 'Veganskt', other: 'Övrigt' })[type];
  }

  foodIcon(type: Recipe['foodType']): string {
    return ({ meat: '🥩', chicken: '🍗', fish: '🐟', vegetarian: '🌿', vegan: '🌱', other: '🍽' })[type];
  }

  async saveRecipe(): Promise<void> {
    this.saveError = '';
    const ingredients: RecipeIngredient[] = this.recipeForm.ingredients
      .map((item) => ({ name: item.name.trim(), amount: item.amount.trim(), unit: item.unit.trim(), sectionCode: item.sectionCode ?? '' }))
      .filter((item) => item.name);
    const steps = this.recipeForm.steps.map((step) => step.trim()).filter(Boolean);
    if (!this.recipeForm.title.trim()) {
      this.saveError = 'Skriv ett namn på receptet.';
      document.getElementById('recipe-title')?.focus();
      return;
    }
    if (!ingredients.length) {
      this.saveError = 'Lägg till minst en ingrediens.';
      document.getElementById('ingredient-name-0')?.focus();
      return;
    }
    if (!steps.length) {
      this.saveError = 'Lägg till minst ett steg i tillagningen.';
      document.getElementById('recipe-step-0')?.focus();
      return;
    }
    this.saving = true;
    try {
      const draft: RecipeDraft = {
        ...this.recipeForm,
        title: this.recipeForm.title.trim(),
        description: this.recipeForm.description.trim(),
        ingredients,
        steps,
      };
      const saved = this.editingRecipeId
        ? await this.recipesApi.updateRecipe(this.editingRecipeId, draft)
        : await this.recipesApi.createRecipe(draft);
      this.recipes = [saved, ...this.recipes.filter((recipe) => recipe.id !== saved.id)];
      this.selectedRecipeDetail = saved;
      this.savedTitle = saved.title;
      this.screen = this.editingRecipeId ? 'recipe-detail' : 'saved';
      this.editingRecipeId = null;
    } catch {
      this.saveError = 'Receptet kunde inte sparas. Försök igen när anslutningen fungerar.';
    } finally {
      this.saving = false;
      this.refreshView();
    }
  }

  async addShoppingItem(): Promise<void> {
    if (!this.shoppingList || !this.shoppingItemDraft.name.trim()) return;
    this.shoppingItemSaving = true;
    this.shoppingItemError = '';
    this.shoppingItemMessage = '';
    try {
      const item = await this.recipesApi.addShoppingItem(this.shoppingList.id, {
        name: this.shoppingItemDraft.name.trim(), amount: this.shoppingItemDraft.amount.trim(), unit: this.shoppingItemDraft.unit.trim(),
      });
      this.shoppingList = { ...this.shoppingList, items: [...this.shoppingList.items, item] };
      this.shoppingItemDraft = { name: '', amount: '', unit: '' };
      this.shoppingItemMessage = 'Tillagd i listan.';
    } catch {
      this.shoppingItemError = 'Varan kunde inte läggas till. Försök igen.';
    } finally {
      this.shoppingItemSaving = false;
      this.refreshView();
    }
  }

  async deleteShoppingItem(item: ShoppingListItem): Promise<void> {
    if (!this.shoppingList) return;
    this.shoppingItemMessage = '';
    const previousList = this.shoppingList;
    this.deletingShoppingItemId = item.id;
    this.shoppingItemMessage = 'Tar bort varan…';
    this.shoppingList = { ...previousList, items: previousList.items.filter((entry) => entry.id !== item.id) };
    try {
      await this.recipesApi.deleteShoppingItem(item.id);
      this.shoppingItemError = '';
      this.shoppingItemMessage = 'Varan är borttagen.';
    } catch {
      this.shoppingList = previousList;
      this.shoppingItemError = 'Varan kunde inte tas bort. Försök igen.';
    } finally {
      this.deletingShoppingItemId = null;
      this.refreshView();
    }
  }

  editShoppingItem(item: ShoppingListItem): void {
    this.editingShoppingItemId = item.id;
    this.editingShoppingItemDraft = { name: item.name, amount: item.amount, unit: item.unit };
  }

  async saveShoppingItem(item: ShoppingListItem): Promise<void> {
    if (!this.shoppingList || !this.editingShoppingItemDraft.name.trim()) return;
    this.savingShoppingItemId = item.id;
    this.shoppingItemMessage = 'Sparar ändringen…';
    try {
      const updated = await this.recipesApi.updateShoppingItem(item.id, {
        name: this.editingShoppingItemDraft.name.trim(), amount: this.editingShoppingItemDraft.amount.trim(), unit: this.editingShoppingItemDraft.unit.trim(),
      });
      this.shoppingList = { ...this.shoppingList, items: this.shoppingList.items.map((entry) => entry.id === item.id ? updated : entry) };
      this.editingShoppingItemId = null;
      this.shoppingItemError = '';
      this.shoppingItemMessage = 'Ändringen är sparad.';
    } catch {
      this.shoppingItemError = 'Ändringen kunde inte sparas. Försök igen.';
    } finally {
      this.savingShoppingItemId = null;
      this.refreshView();
    }
  }

  async setItemSection(item: ShoppingListItem, sectionCode: string): Promise<void> {
    this.savingItemSectionId = item.id;
    this.shoppingItemError = '';
    this.shoppingItemMessage = 'Sparar avdelningen…';
    try {
      const updated = await this.recipesApi.updateShoppingItem(item.id, { sectionCode });
      this.shoppingList = { ...this.shoppingList!, items: this.shoppingList!.items.map((entry) => entry.id === item.id ? updated : entry) };
      this.editingSectionItemId = null;
      this.shoppingItemMessage = sectionCode ? 'Avdelningen är sparad och ihågkommen.' : 'Varan är oplacerad.';
    } catch {
      this.shoppingItemError = 'Avdelningen kunde inte sparas. Försök igen.';
    } finally {
      this.savingItemSectionId = null;
      this.refreshView();
    }
  }

  sectionName(code: string): string {
    return this.storeSections.find((section) => section.code === code)?.name ?? 'Avdelning saknas';
  }

  toggleSectionEditor(item: ShoppingListItem): void {
    this.editingSectionItemId = this.editingSectionItemId === item.id ? null : item.id;
  }

  toggleIngredientSection(index: number): void {
    this.ingredientSectionOpenIndex = this.ingredientSectionOpenIndex === index ? null : index;
  }

  closeIngredientSection(index: number): void {
    if (this.ingredientSectionOpenIndex === index) this.ingredientSectionOpenIndex = null;
  }

  async regenerateShoppingList(): Promise<void> {
    if (!this.shoppingList || !window.confirm('Skapa om listan från veckans recept? Egna ändringar i listan tas bort.')) return;
    this.listGenerating = true;
    this.shoppingItemError = '';
    try {
      this.shoppingList = await this.recipesApi.createWeeklyShoppingList(this.weekStart, true);
      this.shoppingItemDraft = { name: '', amount: '', unit: '' };
    } catch {
      this.shoppingItemError = 'Listan kunde inte skapas om. Försök igen.';
    } finally {
      this.listGenerating = false;
      this.refreshView();
    }
  }
}
