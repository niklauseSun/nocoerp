import { useCan } from '@nocobase/app-plugin-authorization/client';
export const scalar = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';
export const useEnergyCan = (action: string) =>
  useCan({ resource: { type: 'composite', id: 'hyl.energy' }, action });
export const kindFrom = (path: string) => {
  const last = [
    ...path.matchAll(
      /\/(meters|energyMeters|meter|readings|energyReadings|reading|billing|energyBilling)(?=\/|$)/g,
    ),
  ].at(-1)?.[1];
  return ['meters', 'energyMeters', 'meter'].includes(last ?? '')
    ? 'meters'
    : ['billing', 'energyBilling'].includes(last ?? '')
      ? 'billing'
      : 'readings';
};
export const endpoint = (kind: string) =>
  kind === 'meters'
    ? 'energyMeters'
    : kind === 'billing'
      ? 'energyBillingSources'
      : 'energyReadings';
