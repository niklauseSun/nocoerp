import { DateField } from '../billing/common.js';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Choice,
  Search,
  Paged,
  BillingError,
  LoadingRows,
} from '../cashier/common.js';
import type {
  Kind,
  Row as Base,
  Event,
  Item,
} from '../../../server/procurement/model.js';
export type { Kind, Item };
export type Page<T> = {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
};
export type Row = Base & {
  allowedActions: string[];
  blockedActions: Record<string, string>;
  outstandingCents: string;
  events?: Page<Event>;
};
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
  Confirm,
  Truncated,
} from '../cashier/common.js';
export { RecordedAt } from '../profit-sharing/common.js';
export function State({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        ['settled', 'accepted', 'approved', 'active', 'posted'].includes(value)
          ? 'success'
          : ['pending', 'issued'].includes(value)
            ? 'warning'
            : 'neutral'
      }
    >
      {t('procurement.states.' + value)}
    </StatusBadge>
  );
}
export function TextField({
  name,
  label,
  value,
  onChange,
  error,
  required = false,
  multiline = false,
  type = 'text',
}: {
  name: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  multiline?: boolean;
  type?: string;
}) {
  const { t } = useTranslation(),
    props = {
      id: 'cashier-' + name,
      value,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => onChange(e.target.value),
      'aria-invalid': !!error,
      'aria-describedby': error ? 'error-' + name : undefined,
      maxLength: 2000,
    };
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>
        {label ?? t('procurement.fields.' + name)}
        {required ? ' *' : ''}
      </FieldLabel>
      {type === 'date' ? (
        <DateField id={props.id} value={value} onChange={onChange} />
      ) : multiline ? (
        <Textarea {...props} />
      ) : (
        <Input {...props} type={type} />
      )}{' '}
      {error ? <FieldError id={'error-' + name}>{error}</FieldError> : null}
    </Field>
  );
}
export function Picker({
  name,
  path,
  query = {},
  value,
  caption,
  onChange,
  error,
}: {
  name: string;
  path: string;
  query?: Record<string, string | number>;
  value: string;
  caption?: string;
  onChange: (id: string, label: string) => void;
  error?: string;
}) {
  const { t } = useTranslation(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [picked, setPicked] = useState(''),
    result = useBusinessQuery<
      Page<{ id: string; name?: string; title?: string; number?: string }>
    >(path, { ...query, q, page, pageSize: 20 });
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('procurement.fields.' + name)} {name === 'repairId' ? '' : '*'}
      </FieldLabel>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('procurement.search')}
      />
      <Choice
        id={'cashier-' + name}
        value={value}
        ariaLabel={t('procurement.choose')}
        onChange={(v) => {
          const r = result.data?.data.find((r) => r.id === v),
            label = r
              ? [r.number, r.name || r.title].filter(Boolean).join(' · ')
              : '';
          setPicked(label);
          onChange(v, label);
        }}
        options={[
          ...(value
            ? [
                {
                  value,
                  label:
                    picked ||
                    result.data?.data.find((r) => r.id === value)?.name ||
                    result.data?.data.find((r) => r.id === value)?.title ||
                    caption ||
                    value,
                },
              ]
            : []),
          ...(!result.isPlaceholderData
            ? (result.data?.data
                .filter((r) => r.id !== value)
                .map((r) => ({
                  value: r.id,
                  label: [r.number, r.name || r.title]
                    .filter(Boolean)
                    .join(' · '),
                })) ?? [])
            : []),
        ]}
      />
      {result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !result.data ? (
        <LoadingRows />
      ) : (
        <Paged meta={result.data.meta} onChange={setPage} />
      )}{' '}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
