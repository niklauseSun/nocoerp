import { useBusinessQuery, useErrorText } from './hooks.js';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ComponentProps } from 'react';
import { DatePicker } from '#components/date-picker';
import { Input } from '#components/ui/input';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from '#components/ui/select';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Skeleton } from '#components/ui/skeleton';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import type { BusinessRow } from './model.js';

export function ErrorPanel({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  const message = useErrorText();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {message(error)}
        {status === 401 ? (
          <Button
            nativeButton={false}
            render={<Link to='/login' />}
            variant='outline'
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
export function LoadingRows() {
  const { t } = useTranslation();
  return (
    <div aria-label={t('hyl.copy.load')} className='flex flex-col gap-4'>
      {[1, 2, 3].map((n) => (
        <Skeleton key={n} className='h-12 w-full' />
      ))}
    </div>
  );
}
export function Refresh({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='outline'
            size='icon'
            aria-label={t('hyl.actions.refresh')}
            disabled={busy}
            onClick={onClick}
          />
        }
      >
        <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
      </TooltipTrigger>
      <TooltipContent>{t('hyl.actions.refresh')}</TooltipContent>
    </Tooltip>
  );
}
export function Choice({
  value,
  onChange,
  options,
  ariaLabel,
  ariaDescribedBy,
  invalid,
  showMobileLabel = false,
  id,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  showMobileLabel?: boolean;
  id?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Select
      items={options}
      value={value || null}
      onValueChange={(v) => onChange(String(v ?? ''))}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid}
        className='w-full'
      >
        <SelectValue placeholder={t('hyl.actions.choose')}>
          {showMobileLabel && ariaLabel ? (
            <span className='md:hidden'>{ariaLabel} · </span>
          ) : null}
          {options.find((o) => o.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem value={o.value} key={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
export function DateField(
  props: Omit<ComponentProps<typeof DatePicker>, 'placeholder'>,
) {
  const { t } = useTranslation();
  return <DatePicker {...props} placeholder={t('hyl.actions.choose')} />;
}
export function RecordPicker({
  kind,
  value,
  onChange,
  merchantId,
  id,
  disabled = false,
}: {
  kind: 'merchants' | 'contracts';
  value: string;
  onChange: (v: string) => void;
  merchantId?: string;
  id: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const selected = useBusinessQuery<{ data: BusinessRow }>(
    `${kind}/${value}`,
    undefined,
    !!value,
  );
  const result = useBusinessQuery<{
    data: BusinessRow[];
    meta: { total: number };
  }>(kind, { q, page, pageSize: 20, ...(merchantId ? { merchantId } : {}) });
  if (result.error)
    return (
      <ErrorPanel error={result.error} retry={() => void result.refetch()} />
    );
  return (
    <div className='flex flex-col gap-2'>
      {!disabled ? (
        <Input
          aria-label={t('hyl.copy.search')}
          placeholder={t('hyl.copy.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      ) : null}
      <Choice
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled || result.isPending}
        options={[
          ...(selected.data?.data &&
          !result.data?.data.some((r) => r.id === value)
            ? [selected.data.data]
            : []),
          ...(result.data?.data ?? []),
        ].map((r) => ({
          value: r.id,
          label: kind === 'merchants' ? `${r.name} · ${r.number}` : r.number,
        }))}
      />
      {result.data?.meta.total === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {t(`hyl.copy.${kind === 'merchants' ? 'noMerchant' : 'noContract'}`)}
        </p>
      ) : null}
      {(result.data?.meta.total ?? 0) > 20 ? (
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={page === 1 || result.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('hyl.actions.previous')}
          </Button>
          <span className='text-sm text-muted-foreground'>
            {t('hyl.copy.count', { total: result.data?.meta.total, page })}
          </span>
          <Button
            type='button'
            variant='outline'
            disabled={
              page * 20 >= (result.data?.meta.total ?? 0) || result.isFetching
            }
            onClick={() => setPage(page + 1)}
          >
            {t('hyl.actions.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
