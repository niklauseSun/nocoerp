import { useRecordSearchState } from '#hooks/use-record-search';
import { RecordSearch } from '#components/record-search';
import { DateField } from '../billing/common.js';
import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { useBusinessQuery } from '../hyl/hooks.js';
import { Paged, BillingError } from '../cashier/common.js';
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
  disabled = false,
  error,
}: {
  name: string;
  path: string;
  query?: Record<string, string | number>;
  value: string;
  caption?: string;
  disabled?: boolean;
  onChange: (id: string, label: string) => void;
  error?: string;
}) {
  const { t } = useTranslation(),
    { q, setQ, page, setPage } = useRecordSearchState(
      path + JSON.stringify(query),
    );
  const result = useBusinessQuery<
    Page<{ id: string; name?: string; title?: string; number?: string }>
  >(path, { ...query, q, page, pageSize: 20 });
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('procurement.fields.' + name)} {name === 'repairId' ? '' : '*'}
      </FieldLabel>
      <RecordSearch
        disabled={disabled}
        id={'cashier-' + name}
        label={
          t('procurement.fields.' + name) + (name === 'repairId' ? '' : ' *')
        }
        value={value}
        caption={caption}
        invalid={!!error}
        scopeKey={path + JSON.stringify(query)}
        placeholder={t('procurement.search')}
        options={(result.isPlaceholderData ? [] : result.data?.data || []).map(
          (r) => ({
            value: r.id,
            label: [r.number, r.name || r.title].filter(Boolean).join(' · '),
          }),
        )}
        loading={result.isFetching}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        onChange={onChange}
        status={
          result.error ? (
            <BillingError
              error={result.error}
              retry={() => void result.refetch()}
            />
          ) : undefined
        }
        footer={
          result.data && result.data.meta.total > 20 ? (
            <Paged
              meta={result.data.meta}
              onChange={setPage}
              busy={result.isFetching}
            />
          ) : undefined
        }
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
