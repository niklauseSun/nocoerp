import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { Field, FieldLabel } from '#components/ui/field';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
} from '../cashier/common.js';
import type {
  RecordRow,
  Event,
  Kind,
} from '../../../server/inspections/model.js';
export {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Group,
  Refresh,
  Truncated,
  Confirm,
} from '../cashier/common.js';
export { FormField } from '../cashier/common.js';
export { Day, DateField } from '../billing/common.js';
export { RecordedAt } from '../profit-sharing/common.js';
export type { Kind };
export type Page<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};
export type Row = RecordRow & {
  allowedActions: string[];
  blockedActions: Record<string, string>;
  overdue: boolean;
  events?: Page<Event>;
};
export type Item = { id: string; name: string; standard: string };
export type Answer = { itemId: string; result: string; note: string };
export function State({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        ['closed', 'completed'].includes(value)
          ? 'success'
          : value === 'pendingReview'
            ? 'warning'
            : ['archived', 'cancelled'].includes(value)
              ? 'neutral'
              : 'info'
      }
    >
      {t('inspection.states.' + value)}
    </StatusBadge>
  );
}
export function Picker({
  kind,
  value,
  onChange,
  multiple = false,
  caption = '',
  captions = {},
}: {
  kind: 'inspectionAssets' | 'inspectionAssignees';
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  caption?: string;
  captions?: Record<string, string>;
}) {
  const { t } = useTranslation(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [labels, setLabels] = useState<Record<string, string>>({});
  const rows = useBusinessQuery<
    Page<{ id: string; name: string; number?: string }>
  >(kind, { q, page, pageSize: 20 });
  const choices = rows.isPlaceholderData ? [] : (rows.data?.data ?? []);
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + (multiple ? 'assets' : 'assigneeId')}>
        {t('inspection.fields.' + (multiple ? 'assets' : 'assigneeId'))} *
      </FieldLabel>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('inspection.pickerSearch')}
      />
      {value.length ? (
        <div className='flex flex-wrap gap-2'>
          {value.map((id) => (
            <Button
              key={id}
              type='button'
              variant='outline'
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              {labels[id] ||
                captions[id] ||
                choices.find((v) => v.id === id)?.name ||
                caption ||
                id}{' '}
              · {t('inspection.remove')}
            </Button>
          ))}
        </div>
      ) : null}
      {rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data || rows.isPlaceholderData ? (
        <LoadingRows />
      ) : (
        <>
          <Choice
            id={'cashier-' + (multiple ? 'assets' : 'assigneeId')}
            value={multiple ? '' : (value[0] ?? '')}
            onChange={(id) => {
              const r = choices.find((a) => a.id === id);
              if (!r) return;
              setLabels((v) => ({
                ...v,
                [id]: [r.number, r.name].filter(Boolean).join(' · '),
              }));
              onChange(
                multiple ? [...new Set([...value, id])].slice(0, 20) : [id],
              );
            }}
            options={choices.map((v) => ({
              value: v.id,
              label: [v.number, v.name].filter(Boolean).join(' · '),
            }))}
          />
          <Paged
            meta={rows.data.meta}
            onChange={setPage}
            busy={rows.isFetching}
          />
        </>
      )}
      {multiple ? (
        <p className='text-sm text-muted-foreground'>
          {t('inspection.selection', { count: value.length })}
        </p>
      ) : null}
    </Field>
  );
}
