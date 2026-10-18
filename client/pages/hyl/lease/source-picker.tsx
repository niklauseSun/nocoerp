import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Choice } from '../common.js';
export function SourcePicker({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; kind?: string }[];
  disabled: boolean;
}) {
  const { t } = useTranslation(),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [sourceType, setSourceType] = useState('all');
  const matches = options.filter(
      (o) =>
        (sourceType === 'all' || o.kind === sourceType) &&
        o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
    selected = options.find((o) => o.value === value),
    visible = matches.slice((page - 1) * 10, page * 10);
  const items =
    selected && !visible.some((o) => o.value === selected.value)
      ? [selected, ...visible]
      : visible;
  return (
    <div className='space-y-2'>
      <Choice
        ariaLabel={t('lease.sourceType')}
        value={sourceType}
        onChange={(v) => {
          setSourceType(v);
          setPage(1);
        }}
        disabled={disabled}
        options={[
          'all',
          'settlement',
          'charge',
          ...(options.some((o) => o.kind === 'bill') ? ['bill'] : []),
        ].map((v) => ({
          value: v,
          label: t(`lease.sourceTypes.${v}`),
        }))}
      />
      <Input
        aria-label={t('lease.sourceSearch')}
        placeholder={t('lease.sourceSearch')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        disabled={disabled}
      />
      {matches.length || selected ? (
        <Choice
          id='lease-sourceId'
          ariaLabel={t('lease.source')}
          value={value}
          onChange={onChange}
          options={items}
          disabled={disabled}
        />
      ) : (
        <p className='text-sm text-muted-foreground'>{t('lease.noSources')}</p>
      )}
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {t('hyl.actions.previous')}
        </Button>
        <span className='text-sm'>
          {t('lease.total', { count: matches.length })}
        </span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || page * 10 >= matches.length}
          onClick={() => setPage((p) => p + 1)}
        >
          {t('hyl.actions.next')}
        </Button>
      </div>
    </div>
  );
}
