import { useRecordSearchState } from '#hooks/use-record-search';
import { RecordSearch } from '#components/record-search';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  Paged,
  Values,
  Money,
  Day,
  State,
  BillingError,
  type Page,
} from './common.js';
export type LegacyCandidate = {
  id: string;
  meterCode: string;
  assetId: string;
  assetName: string;
  feeType: string;
  start: string;
  openingReading: string;
  multiplier: string;
  lastBillNumber: string;
  lastBillEnd: string;
  draftCount: number;
  historyTotal: number;
  history: {
    id: string;
    billNumber: string;
    start: string;
    end: string;
    current: string;
    amountCents: string;
    status: string;
  }[];
};
export function LegacyPicker({
  contractId,
  disabled,
  onSelect,
}: {
  contractId: string;
  disabled: boolean;
  onSelect: (v: LegacyCandidate | undefined) => void;
}) {
  const { t } = useTranslation(),
    { q, setQ, page, setPage } = useRecordSearchState('legacy:' + contractId),
    [selected, setSelected] = useState<LegacyCandidate>(),
    r = useBusinessQuery<Page<LegacyCandidate>>(
      'energyLegacyMeters',
      { contractId, q, page, pageSize: 20 },
      !!contractId,
    );
  return (
    <Group title={t('energy.legacyCandidates')}>
      <RecordSearch
        label={t('energy.legacyCandidates')}
        value={selected?.id || ''}
        scopeKey={'legacy:' + contractId}
        disabled={disabled || !contractId}
        loading={r.isFetching}
        options={(r.isPlaceholderData ? [] : r.data?.data || []).map((x) => ({
          value: x.id,
          label:
            x.meterCode +
            ' · ' +
            t('energy.types.' + x.feeType) +
            ' · ' +
            x.start,
        }))}
        caption={selected?.meterCode}
        onSearch={(v) => {
          setQ(v);
          setPage(1);
        }}
        onChange={(id) => {
          const candidate = r.data?.data.find((x) => x.id === id);
          setSelected(candidate);
          onSelect(candidate);
        }}
        placeholder={t('energy.searchMeters')}
        status={
          !contractId ? (
            <p>{t('energy.chooseContract')}</p>
          ) : r.error ? (
            <BillingError error={r.error} retry={() => void r.refetch()} />
          ) : undefined
        }
        footer={
          r.data && r.data.meta.total > 20 ? (
            <Paged meta={r.data.meta} busy={r.isFetching} onChange={setPage} />
          ) : undefined
        }
      />
      {selected ? (
        <>
          <Values
            values={{
              meterCode: selected.meterCode,
              start: selected.start,
              openingReading: selected.openingReading,
              multiplier: selected.multiplier,
              lastBillNumber: selected.lastBillNumber,
              lastBillEnd: selected.lastBillEnd,
              draftCount: selected.draftCount,
            }}
          />
          {selected.draftCount ? (
            <p className='text-destructive'>{t('energy.legacyDraftBlocked')}</p>
          ) : null}
          <p className='text-sm text-muted-foreground'>
            {t('energy.legacyHistory', { total: selected.historyTotal })}
          </p>
          {selected.history.map((h) => (
            <div
              key={h.id}
              className='flex flex-wrap items-center gap-2 border-b py-2'
            >
              <span>{h.billNumber}</span>
              <Day value={h.start} />
              <Day value={h.end} />
              <Money cents={h.amountCents} />
              <State value={h.status} />
            </div>
          ))}
        </>
      ) : null}
    </Group>
  );
}
