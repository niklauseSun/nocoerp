import {
  useRecordSearchState,
  useRecordSearchScope,
} from '#hooks/use-record-search';
import { RecordSearch } from '#components/record-search';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { Field, FieldLabel } from '#components/ui/field';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Paged, BillingError } from '../cashier/common.js';
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
  disabled = false,
  multiple = false,
  caption = '',
  captions = {},
}: {
  kind: 'inspectionAssets' | 'inspectionAssignees';
  value: string[];
  disabled?: boolean;
  onChange: (v: string[]) => void;
  multiple?: boolean;
  caption?: string;
  captions?: Record<string, string>;
}) {
  const { t } = useTranslation(),
    { q, setQ, page, setPage } = useRecordSearchState(kind),
    [labelCache, setLabelCache] = useState<{
      scope: string;
      labels: Record<string, string>;
    }>({ scope: '', labels: {} });
  const scope = useRecordSearchScope(kind),
    labels = labelCache.scope === scope ? labelCache.labels : {};
  const rows = useBusinessQuery<
    Page<{ id: string; name: string; number?: string }>
  >(kind, { q, page, pageSize: 20 });
  const choices = rows.isPlaceholderData ? [] : rows.data?.data || [],
    title = t('inspection.fields.' + (multiple ? 'assets' : 'assigneeId'));
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + (multiple ? 'assets' : 'assigneeId')}>
        {title} *
      </FieldLabel>
      <RecordSearch
        disabled={disabled}
        id={'cashier-' + (multiple ? 'assets' : 'assigneeId')}
        label={title + ' *'}
        value={multiple ? '' : value[0] || ''}
        scopeKey={kind}
        caption={!multiple ? captions[value[0]] || caption : undefined}
        hasSelection={multiple && value.length > 0}
        onClear={() => onChange([])}
        loading={rows.isFetching}
        options={choices
          .filter((r) => !multiple || !value.includes(r.id))
          .map((r) => ({
            value: r.id,
            label: [r.number, r.name].filter(Boolean).join(' · '),
          }))}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        onChange={(id, label) => {
          if (!id) {
            if (!multiple) onChange([]);
            return;
          }
          setLabelCache((v) => ({
            scope,
            labels: { ...(v.scope === scope ? v.labels : {}), [id]: label },
          }));
          onChange(multiple ? [...new Set([...value, id])].slice(0, 20) : [id]);
        }}
        placeholder={t('inspection.pickerSearch')}
        status={
          rows.error ? (
            <BillingError
              error={rows.error}
              retry={() => void rows.refetch()}
            />
          ) : undefined
        }
        footer={
          rows.data && rows.data.meta.total > 20 ? (
            <Paged
              meta={rows.data.meta}
              onChange={setPage}
              busy={rows.isFetching}
            />
          ) : undefined
        }
      />
      {multiple && value.length ? (
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
      {multiple ? (
        <p className='text-sm text-muted-foreground'>
          {t('inspection.selection', { count: value.length })}
        </p>
      ) : null}
    </Field>
  );
}
