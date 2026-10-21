import { z } from 'zod';
import { date } from '../hyl/schema.js';
import { cents } from '../hyl/calculation.js';
const text = (n: number) => z.string().trim().max(n).default('');
export const assetTypes = [
  'project',
  'street',
  'building',
  'unit',
  'stall',
] as const;
export const areaSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
export const assetSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(assetTypes),
    parentId: z.string().uuid().nullable().default(null),
    area: areaSchema.default('0'),
    lettableArea: areaSchema.default('0'),
    state: z.enum(['normal', 'maintenance', 'inactive']).default('normal'),
    address: text(300),
    floor: text(50),
    location: text(300),
    ownershipType: text(100),
    ownerName: text(100),
    ownershipNumber: text(100),
    manager: text(100),
    notes: text(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      areaSchema.safeParse(v.area).success &&
      areaSchema.safeParse(v.lettableArea).success &&
      cents(v.lettableArea) > cents(v.area)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['lettableArea'],
        message: 'ASSET_AREA',
      });
    if ((v.type === 'project') !== (v.parentId === null))
      ctx.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'ASSET_PARENT',
      });
  });
export const bindingSchema = z
  .object({
    requestId: z.string().uuid(),
    assetId: z.string().uuid(),
    start: date,
    end: z.union([z.literal(''), date]).default(''),
    area: areaSchema.default('0'),
  })
  .strict()
  .refine((v) => !v.end || v.end >= v.start, {
    path: ['end'],
    message: 'INVALID_PERIOD',
  });
export const fileLinkSchema = z
  .object({
    fileId: z.string().uuid(),
    category: z.enum(['drawing', 'photo', 'ownership']),
    title: z.string().trim().min(1).max(100),
  })
  .strict();
export type Asset = z.infer<typeof assetSchema> & {
  id: string;
  number: string;
  projectId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Binding = z.infer<typeof bindingSchema> & {
  id: string;
  merchantId: string;
  actor: string;
  version: number;
  createdAt: string;
};
export const assetFields = [
  'id',
  'number',
  'name',
  'type',
  'parentId',
  'projectId',
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
  'version',
  'createdAt',
  'updatedAt',
];
export const parents: Record<string, string[]> = {
  project: [],
  street: ['project'],
  building: ['street'],
  unit: ['building', 'street'],
  stall: ['building', 'street'],
};
export const isLeaf = (type: string) => type === 'unit' || type === 'stall';

export interface ContractAsset {
  id: string;
  assetId: string;
  merchantId: string;
  contractId: string;
  start: string;
  end: string;
  snapshot: ReturnType<typeof import('./transactions.js').assetSummary>;
  createdAt: string;
}
