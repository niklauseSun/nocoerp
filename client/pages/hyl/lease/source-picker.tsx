import { useRecordSearchState } from '#hooks/use-record-search';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { RecordSearch } from '#components/record-search';
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
    [sourceType, setSourceType] = useState('all'),
    {
      q: search,
      setQ: setSearch,
      page,
      setPage,
    } = useRecordSearchState('lease-source:' + sourceType);
  const matches = options.filter(
      (o) =>
        (sourceType === 'all' || o.kind === sourceType) &&
        o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
    selected = options.find((o) => o.value === value),
    visible = matches.slice((page - 1) * 10, page * 10);
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
      <RecordSearch
        id='lease-sourceId'
        label={t('lease.source')}
        value={value}
        caption={selected?.label}
        options={visible}
        disabled={disabled}
        scopeKey={'lease-source:' + sourceType}
        placeholder={t('hyl.copy.sourceSearch')}
        onChange={onChange}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        footer={
          <div className='flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={disabled || page === 1}
              onClick={() => setPage(page - 1)}
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
              onClick={() => setPage(page + 1)}
            >
              {t('hyl.actions.next')}
            </Button>
          </div>
        }
      />
    </div>
  );
}
