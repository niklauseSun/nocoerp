import { str } from './helpers.js';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { useBusinessQuery } from '../hyl/hooks.js';
import type {
  RepairOrder,
  RepairEvent,
} from '../../../server/repairs/model.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
} from '../cashier/common.js';
export {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
  Group,
  Money,
  Day,
  Refresh,
  Truncated,
  Confirm,
} from '../cashier/common.js';
export { DateField } from '../billing/common.js';
export { RecordedAt } from '../profit-sharing/common.js';
export type Page<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};
export type Order = RepairOrder & {
  allowedActions: string[];
  blockedActions: string[];
  blockedReasons?: Record<string, string>;
  overdue: boolean;
  events?: Page<RepairEvent>;
};
export function RepairState({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        ['closed', 'accepted'].includes(value)
          ? 'success'
          : value === 'pendingAcceptance'
            ? 'warning'
            : value === 'cancelled'
              ? 'neutral'
              : 'info'
      }
    >
      {t('repair.states.' + value)}
    </StatusBadge>
  );
}
export function TextField({
  name,
  value,
  onChange,
  required = false,
  error,
  multiline = false,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  multiline?: boolean;
}) {
  const { t } = useTranslation();
  const props = {
    id: 'cashier-' + name,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    'aria-invalid': !!error,
  };
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>
        {t('repair.fields.' + name)}
        {required ? ' *' : ''}
      </FieldLabel>
      {multiline ? <Textarea {...props} /> : <Input {...props} />}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
export function RepairPicker({
  kind,
  name,
  value,
  onChange,
  required = false,
  error,
}: {
  kind: 'assets' | 'merchants' | 'contracts' | 'repairAssignees';
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
}) {
  const { t } = useTranslation(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState<{ value: string; label: string }>();
  const rows = useBusinessQuery<Page<Record<string, unknown>>>(kind, {
      q,
      page,
      pageSize: 20,
    }),
    selected = useBusinessQuery<{ data: Record<string, unknown> }>(
      kind + '/' + value,
      undefined,
      !!value && kind !== 'repairAssignees',
    );
  const label = (r: Record<string, unknown>) =>
    [
      r.number,
      r.name,
      (r.payload as Record<string, unknown> | undefined)?.name,
      (r.payload as Record<string, unknown> | undefined)?.title,
    ]
      .map(str)
      .filter(Boolean)
      .join(' · ');
  const options =
    (rows.isPlaceholderData
      ? []
      : rows.data?.data.map((r) => ({ value: str(r.id), label: label(r) }))) ??
    [];
  if (value && !options.some((o) => o.value === value)) {
    const selectedValue = selected.data?.data;
    if (chosen?.value === value) options.push(chosen);
    else if (selectedValue)
      options.push({ value, label: label(selectedValue) });
  }
  const selectedCaption =
    options.find((o) => o.value === value)?.label ||
    (chosen?.value === value ? chosen.label : '') ||
    (selected.data?.data ? label(selected.data.data) : '');
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('repair.fields.' + name)}
        {required ? ' *' : ''}
      </FieldLabel>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('repair.searchPicker')}
      />
      {value && selectedCaption ? (
        <p className='text-sm text-muted-foreground'>{selectedCaption}</p>
      ) : null}
      {rows.error ? (
        <BillingError error={rows.error} retry={() => void rows.refetch()} />
      ) : !rows.data || rows.isPlaceholderData ? (
        <LoadingRows />
      ) : (
        <>
          <Choice
            id={'cashier-' + name}
            disabled={rows.isFetching}
            value={value}
            onChange={(v) => {
              setChosen(options.find((o) => o.value === v));
              onChange(v);
            }}
            options={options}
          />
          <Paged
            meta={rows.data.meta}
            onChange={setPage}
            busy={rows.isFetching}
          />
        </>
      )}
      {!required && value ? (
        <Button type='button' variant='outline' onClick={() => onChange('')}>
          {t('repair.clearSelection')}
        </Button>
      ) : null}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
