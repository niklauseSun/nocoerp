import { z } from 'zod';
import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
import { decimal } from '../billing/model.js';
const text = (n: number) => z.string().trim().max(n),
  day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(v + 'T00:00:00Z');
      return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
    });
export const meterValues = z
  .object({
    code: text(100).min(1),
    name: text(100).min(1),
    type: z.enum(['water', 'electricity']),
    assetId: z.uuid(),
    installedOn: day,
    openingReading: decimal,
    multiplier: decimal.refine((v) => Number(v) > 0),
    openingEvidence: text(500).min(1),
    notes: text(1000).default(''),
  })
  .strict();
export const assignmentValues = z
  .object({
    contractId: z.uuid(),
    start: day,
    openingReading: decimal,
    evidence: text(500).min(1),
    notes: text(1000).default(''),
  })
  .strict();
export const readingValues = z
  .object({
    meterId: z.uuid(),
    assignmentId: z.string().default(''),
    start: day,
    end: day,
    current: z.union([decimal, z.null()]).default(null),
    evidence: text(500).default(''),
    notes: text(1000).default(''),
  })
  .strict();
export const handoverValues = z
  .object({
    assignmentId: z.uuid(),
    end: day,
    readingId: z.uuid(),
    evidence: text(500).min(1),
    nextContractId: z.string().default(''),
    notes: text(1000).default(''),
  })
  .strict();
export const stopValues = z
  .object({ end: day, reason: text(500).min(1), evidence: text(500).min(1) })
  .strict();
export const adoptValues = z
  .object({
    contractId: z.uuid(),
    assetId: z.uuid(),
    meterCode: text(100).min(1),
    feeType: z.enum(['water', 'electricity']),
    name: text(100).min(1),
    start: day,
    openingReading: decimal,
    multiplier: decimal.refine((v) => Number(v) > 0),
    evidence: text(500).min(1),
  })
  .strict();
export const billingValues = z
  .object({
    contractId: z.uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    part: z.enum(['month', 'first', 'second']),
    dueDate: day,
    readingIds: z.array(z.uuid()).min(1).max(50),
    zeroReason: text(500).default(''),
    zeroEvidence: text(500).default(''),
    notes: text(1000).default(''),
  })
  .strict();
export const operation = z.object({
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0).default(0),
  previewHash: z.string().default(''),
  reason: text(500).default(''),
  expectedMeterVersion: z.number().int().optional(),
});
export const listInput = z.object({
  q: text(200).default(''),
  type: text(30).default(''),
  assetId: z.string().default(''),
  contractId: z.string().default(''),
  meterId: z.string().default(''),
  assignmentId: z.string().default(''),
  billId: z.string().default(''),
  status: text(30).default(''),
  billingStatus: text(30).default(''),
  from: z.string().default(''),
  to: z.string().default(''),
  orderBy: z.string().default('-updatedAt'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type EnergyRecord = {
  id: string;
  number: string;
  assetId: string;
  projectId: string;
  meterId: string;
  contractId: string;
  merchantId: string;
  status: string;
  version: number;
  lifecycleVersion: number;
  statusChangedAt: string;
  code: string | null;
  start: string;
  end: string;
  usageKey: string;
  activeReadingId: string | null;
  billId: string;
  actor: string;
  searchText: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type MeterValues = z.infer<typeof meterValues>;
export type ReadingValues = z.infer<typeof readingValues>;
export type AssignmentValues = z.infer<typeof assignmentValues>;
export type HandoverValues = z.infer<typeof handoverValues>;
export type BillingValues = z.infer<typeof billingValues>;
export type StopValues = z.infer<typeof stopValues>;
export type AdoptValues = z.infer<typeof adoptValues>;
export type Operation = z.infer<typeof operation>;
export type ListInput = z.infer<typeof listInput>;
export const tables = {
  meters: 'hylEnergyMeters',
  readings: 'hylEnergyReadings',
  assignments: 'hylEnergyAssignments',
  billing: 'hylEnergyReadings',
} as const;
export const energyActions = [
  'meterRead',
  'meterWrite',
  'readingRead',
  'readingWrite',
  'readingReview',
  'billGenerate',
] as const;
export const energyFields = [
  'id',
  'number',
  'assetId',
  'projectId',
  'meterId',
  'contractId',
  'merchantId',
  'status',
  'version',
  'lifecycleVersion',
  'statusChangedAt',
  'code',
  'start',
  'end',
  'usageKey',
  'activeReadingId',
  'billId',
  'actor',
  'searchText',
  'payload',
  'createdAt',
  'updatedAt',
];
export const meterLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylEnergyMeters',
  initial: 'active',
  states: ['active', { name: 'stopped', final: true }],
  transitions: { stop: { from: 'active', to: 'stopped' } },
});
export const readingLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylEnergyReadings',
  initial: 'draft',
  states: [
    'draft',
    'submitted',
    'approved',
    'rejected',
    { name: 'voided', final: true },
  ],
  transitions: {
    submit: { from: ['draft', 'rejected'], to: 'submitted' },
    approve: { from: 'submitted', to: 'approved' },
    reject: { from: 'submitted', to: 'rejected' },
    void: { from: ['draft', 'rejected', 'approved'], to: 'voided' },
  },
});
