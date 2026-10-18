import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import { Link } from 'react-router';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useErrorText } from '../hyl/hooks.js';
import { formatMoney } from './format.js';
import type { Meta } from './types.js';
export {
  Choice,
  DateField,
  LoadingRows,
  Refresh,
  RecordPicker,
} from '../hyl/common.js';
function useBillingError() {
  const { t, i18n } = useTranslation(),
    fallback = useErrorText();
  return (error: unknown) =>
    error instanceof ApiClientError &&
    i18n.exists(`billing.errors.${error.reason}`)
      ? t(`billing.errors.${error.reason}`)
      : fallback(error);
}
export function BillingError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation(),
    message = useBillingError();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {message(error)}
        {status === 401 ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/login' />}
          >
            {t('hyl.actions.login')}
          </Button>
        ) : ![403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t('hyl.actions.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function Money({ cents, value }: { cents?: string; value?: string }) {
  const { i18n } = useTranslation();
  return (
    <span className='tabular-nums'>
      {formatMoney(value ?? cents ?? '0', i18n.language, value === undefined)}
    </span>
  );
}
export function Day({ value }: { value?: string }) {
  const { i18n } = useTranslation();
  return (
    <>
      {value
        ? new Intl.DateTimeFormat(i18n.language, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(value.includes('T') ? value : value + 'T00:00:00'))
        : '—'}
    </>
  );
}
export function State({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        ['paid', 'allocated', 'refunded'].includes(value)
          ? 'success'
          : ['overdue', 'partial', 'missing'].includes(value)
            ? 'warning'
            : ['draft', 'voided'].includes(value)
              ? 'neutral'
              : 'info'
      }
    >
      {t(`billing.states.${value}`)}
    </StatusBadge>
  );
}
export function Paged({
  meta,
  onChange,
  busy = false,
}: {
  meta: Meta;
  onChange: (p: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center justify-end gap-2'>
      <span className='text-sm text-muted-foreground'>
        {t('billing.count', { total: meta.total, page: meta.page })}
      </span>
      <Button
        type='button'
        variant='outline'
        disabled={busy || meta.page === 1}
        onClick={() => onChange(meta.page - 1)}
      >
        {t('hyl.actions.previous')}
      </Button>
      <Button
        type='button'
        variant='outline'
        disabled={busy || meta.page * meta.pageSize >= meta.total}
        onClick={() => onChange(meta.page + 1)}
      >
        {t('hyl.actions.next')}
      </Button>
    </div>
  );
}
export function Value({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className='grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr]'>
      <dt className='text-sm text-muted-foreground'>
        {t(`billing.fields.${label}`)}
      </dt>
      <dd className='min-w-0 text-sm break-words'>{children ?? '—'}</dd>
    </div>
  );
}
export function Metrics({
  values,
}: {
  values: { label: string; cents?: string; value?: string }[];
}) {
  const { t } = useTranslation();
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      {values.map((v) => (
        <Card key={v.label}>
          <CardHeader>
            <CardTitle>{t(`billing.fields.${v.label}`)}</CardTitle>
          </CardHeader>
          <CardContent className='text-xl font-semibold'>
            <Money cents={v.cents} value={v.value} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
export function TextField({
  name,
  value,
  onChange,
  required = false,
  error,
  label,
  disabled,
  decimal = false,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  label?: string;
  disabled?: boolean;
  decimal?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field>
      <FieldLabel htmlFor={`billing-${name}`}>
        {label ?? t(`billing.fields.${name.split('.').at(-1)}`)}
        {required ? ' *' : ''}
      </FieldLabel>
      <Input
        id={`billing-${name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode={decimal ? 'decimal' : undefined}
        aria-invalid={!!error}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
export function Truncated({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null),
    [overflow, setOverflow] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            ref={ref}
            className='block max-w-xs truncate'
            onPointerEnter={() =>
              setOverflow(
                !!ref.current &&
                  ref.current.scrollWidth > ref.current.clientWidth,
              )
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      {overflow ? <TooltipContent>{children}</TooltipContent> : null}
    </Tooltip>
  );
}
export function Search({
  value,
  placeholder,
  onChange,
  id,
}: {
  value: string;
  placeholder: string;
  onChange: (s: string) => void;
  id?: string;
}) {
  const [draft, setDraft] = useState<{
    query: string;
    value: string;
    echo?: string;
  }>(() => ({ query: value, value }));
  const [composing, setComposing] = useState(false);
  // A router echo acknowledges a debounced value; it must not replace newer typing.
  // A different external value (clear, Back/Forward) resets the editor instead.
  if (draft.query !== value)
    setDraft({
      query: value,
      value: draft.echo === value ? draft.value : value,
    });
  useEffect(() => {
    if (
      composing ||
      draft.query !== value ||
      draft.value === value ||
      draft.echo === draft.value
    )
      return;
    const timer = setTimeout(() => {
      setDraft((old) => ({ ...old, echo: draft.value }));
      onChange(draft.value);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, value, composing, onChange]);
  return (
    <Input
      className='w-full sm:max-w-xs'
      id={id}
      aria-label={placeholder}
      placeholder={placeholder}
      value={draft.value}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={(e) => {
        setComposing(false);
        const text = e.currentTarget.value;
        setDraft((old) => ({ ...old, query: value, value: text }));
      }}
      onChange={(e) => {
        const text = e.target.value;
        setDraft((old) => ({ ...old, query: value, value: text }));
      }}
    />
  );
}
