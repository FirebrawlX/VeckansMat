export interface PantryItem {
  id: string;
  name: string;
  amount: string;
  unit: string;
  sectionCode: string;
  position: number;
}

export type PantryItemDraft = Pick<PantryItem, 'name' | 'amount' | 'unit' | 'sectionCode'>;
