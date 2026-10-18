import { Button } from '#components/ui/button';
import { Confirm as SharedConfirm } from '../cashier/common.js';
import { Day } from '../billing/common.js';
import { RecordedAt } from '../profit-sharing/common.js';
import { scalar } from './helpers.js';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Field, FieldLabel } from '#components/ui/field';
import { Badge } from '#components/ui/badge';
import { LongText } from '#components/long-text';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
} from '../cashier/common.js';
export {
  Group,
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  FormField,
  Money,
  Refresh,
  Truncated,
} from '../cashier/common.js';
export { DateField, Day } from '../billing/common.js';
export { RecordedAt } from '../profit-sharing/common.js';
export type { EnergyRecord } from '../../../server/energy/model.js';
export type Item = import('../../../server/energy/model.js').EnergyRecord &
  Record<string, unknown> & { allowedActions: string[] };
export type Page<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
  restricted?: boolean;
};
export function Values({ values }: { values: Record<string, unknown> }) {
  const { t } = useTranslation();
  return (
    <dl className='grid grid-cols-[8rem_1fr] gap-3'>
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className='contents'>
          <dt className='text-muted-foreground'>{t('energy.fields.' + key)}</dt>
          <dd className='whitespace-pre-wrap break-words'>
            {[
              'openingReading',
              'closingReading',
              'multiplier',
              'previous',
              'current',
              'usage',
              'unitPrice',
              'latestReading',
            ].includes(key) && scalar(value) ? (
              <Quantity value={value} />
            ) : ['start', 'end', 'installedOn'].includes(key) &&
              scalar(value) ? (
              <Day value={scalar(value)} />
            ) : ['approvedAt', 'createdAt', 'updatedAt'].includes(key) &&
              scalar(value) ? (
              <RecordedAt value={scalar(value)} />
            ) : (
              scalar(value) || '—'
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function State({ value }: { value: unknown }) {
  const { t } = useTranslation();
  return (
    <Badge variant='secondary'>
      {t(
        (['water', 'electricity'].includes(scalar(value))
          ? 'energy.types.'
          : 'energy.states.') + scalar(value),
      )}
    </Badge>
  );
}
export function Notes({ value }: { value: unknown }) {
  return scalar(value) ? <LongText>{scalar(value)}</LongText> : null;
}
export function Quantity({ value }: { value: unknown }) {
  const { i18n } = useTranslation();
  const number = scalar(value);
  return (
    <span className='tabular-nums'>
      {number
        ? (() => {
            const [whole, fraction] = number.split('.');
            const decimalSeparator =
              new Intl.NumberFormat(i18n.language)
                .formatToParts(1.1)
                .find((p) => p.type === 'decimal')?.value ?? '.';
            return (
              new Intl.NumberFormat(i18n.language).format(BigInt(whole)) +
              (fraction?.replace(/0+$/, '')
                ? decimalSeparator + fraction.replace(/0+$/, '')
                : '')
            );
          })()
        : '—'}
    </span>
  );
}
export function Picker({
  name,
  kind,
  value,
  onChange,
  disabled = false,
  error,
  required = true,
}: {
  name: string;
  kind: 'assets' | 'contracts' | 'energyMeters' | 'energyAssignments';
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
}) {
  const { t } = useTranslation(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    selected = useBusinessQuery<{ data: Record<string, unknown> }>(
      kind + '/' + value,
      undefined,
      !!value && kind !== 'energyAssignments',
    ),
    rows = useBusinessQuery<Page<Record<string, unknown>>>(
      kind,
      { q, page, pageSize: 20 },
      true,
    );
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('energy.fields.' + name)}
        {required ? ' *' : ''}
      </FieldLabel>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('energy.searchPicker')}
      />
      {rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data ? (
        <LoadingRows />
      ) : (
        <>
          <Choice
            id={'cashier-' + name}
            value={value}
            disabled={disabled}
            onChange={onChange}
            options={[
              ...rows.data.data,
              ...(!rows.data.data.some((r) => scalar(r.id) === value) &&
              selected.data
                ? [selected.data.data]
                : []),
            ].map((r) => ({
              value: scalar(r.id),
              label: [
                r.number,
                r.name,
                (r.payload as Record<string, unknown> | undefined)
                  ?.contractNumber,
              ]
                .map(scalar)
                .filter(Boolean)
                .join(' · '),
            }))}
          />
          <Paged
            meta={rows.data.meta}
            busy={rows.isFetching}
            onChange={setPage}
          />
        </>
      )}
      {!required && value ? (
        <Button
          type='button'
          variant='outline'
          disabled={disabled}
          onClick={() => onChange('')}
        >
          {t('energy.clearSelection')}
        </Button>
      ) : null}
      {error ? <p className='text-sm text-destructive'>{error}</p> : null}
    </Field>
  );
}

export function Confirm(props: Parameters<typeof SharedConfirm>[0]) {
  return <SharedConfirm {...props} rich />;
}
