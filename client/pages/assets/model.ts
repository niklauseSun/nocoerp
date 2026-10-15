export const types = [
  'project',
  'street',
  'building',
  'unit',
  'stall',
] as const;
export type AssetType = (typeof types)[number];
export interface Asset {
  id: string;
  number: string;
  name: string;
  type: AssetType;
  parentId: string | null;
  projectId: string;
  area: string;
  lettableArea: string;
  state: 'normal' | 'maintenance' | 'inactive';
  address: string;
  floor: string;
  location: string;
  ownershipType: string;
  ownerName: string;
  ownershipNumber: string;
  manager: string;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  occupied?: boolean;
}
export type AssetValues = Pick<
  Asset,
  | 'name'
  | 'type'
  | 'parentId'
  | 'area'
  | 'lettableArea'
  | 'state'
  | 'address'
  | 'floor'
  | 'location'
  | 'ownershipType'
  | 'ownerName'
  | 'ownershipNumber'
  | 'manager'
  | 'notes'
>;
export interface List<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}
export interface Binding {
  id: string;
  merchantId: string;
  assetId: string;
  start: string;
  end: string;
  area: string;
  version: number;
  asset: Asset | null;
}
export interface ContractAsset {
  id: string;
  assetId: string;
  contractId: string;
  start: string;
  end: string;
  snapshot: Asset;
}
export const defaults: AssetValues = {
  name: '',
  type: 'project',
  parentId: null,
  area: '0',
  lettableArea: '0',
  state: 'normal',
  address: '',
  floor: '',
  location: '',
  ownershipType: '',
  ownerName: '',
  ownershipNumber: '',
  manager: '',
  notes: '',
};
export const fields = [
  'name',
  'type',
  'parentId',
  'area',
  'lettableArea',
  'state',
  'address',
  'floor',
  'location',
  'ownershipType',
  'ownerName',
  'ownershipNumber',
  'manager',
  'notes',
] as const;
export const parentTypes: Record<AssetType, AssetType[]> = {
  project: [],
  street: ['project'],
  building: ['street'],
  unit: ['street', 'building'],
  stall: ['street', 'building'],
};
