import { contractLabel } from '../hyl/contract-label.js';
import type { PhotoGroups } from './photos.js';
import type { FileRecord } from '#extensions/nocobase-file-component-ui/index';
import { useRecordSearchState } from '#hooks/use-record-search';
import { RecordSearch } from '#components/record-search';
import { str } from './helpers.js';
import { useTranslation } from '@nocobase/i18n/client';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { StatusBadge } from '#components/status-badge';
import { useBusinessQuery } from '../hyl/hooks.js';
import type {
  RepairOrder,
  RepairEvent,
} from '../../../server/repairs/model.js';
import { Paged, BillingError } from '../cashier/common.js';
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
  photos?: PhotoGroups;
  events?: Page<RepairEvent & { photos?: FileRecord[] }>;
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
  disabled = false,
  required = false,
  error,
}: {
  kind: 'assets' | 'merchants' | 'contracts' | 'repairAssignees';
  name: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
}) {
  const { t } = useTranslation(),
    { q, setQ, page, setPage } = useRecordSearchState(kind);
  const rows = useBusinessQuery<Page<Record<string, unknown>>>(kind, {
    q,
    page,
    pageSize: 20,
  });
  const selected = useBusinessQuery<{ data: Record<string, unknown> }>(
    kind + '/' + value,
    undefined,
    !!value && kind !== 'repairAssignees',
  );
  const label = (r: Record<string, unknown>) =>
    kind === 'contracts'
      ? contractLabel(r)
      : [
          r.number,
          r.name,
          (r.payload as Record<string, unknown> | undefined)?.name,
          (r.payload as Record<string, unknown> | undefined)?.title,
        ]
          .map(str)
          .filter(Boolean)
          .join(' · ');
  return (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('repair.fields.' + name)}
        {required ? ' *' : ''}
      </FieldLabel>
      <RecordSearch
        disabled={disabled}
        id={'cashier-' + name}
        label={t('repair.fields.' + name) + (required ? ' *' : '')}
        value={value}
        scopeKey={kind}
        invalid={!!error}
        loading={rows.isFetching}
        caption={selected.data?.data ? label(selected.data.data) : undefined}
        options={(rows.isPlaceholderData ? [] : rows.data?.data || []).map(
          (r) => ({ value: str(r.id), label: label(r) }),
        )}
        onChange={onChange}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('repair.searchPicker')}
        status={
          rows.error || selected.error ? (
            <BillingError
              error={rows.error || selected.error}
              retry={() => {
                void rows.refetch();
                if (value) void selected.refetch();
              }}
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
      <FieldError>{error}</FieldError>
    </Field>
  );
}
