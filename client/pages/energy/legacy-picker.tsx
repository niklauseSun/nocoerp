import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useBusinessQuery } from '../hyl/hooks.js';
import {
  Group,
  Choice,
  Search,
  Paged,
  Values,
  Money,
  Day,
  State,
  BillingError,
  LoadingRows,
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
  onSelect: (v: LegacyCandidate) => void;
}) {
  const { t } = useTranslation(),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<LegacyCandidate>(),
    r = useBusinessQuery<Page<LegacyCandidate>>(
      'energyLegacyMeters',
      { contractId, q, page, pageSize: 20 },
      !!contractId,
    );
  return (
    <Group title={t('energy.legacyCandidates')}>
      <Search
        value={q}
        onChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        placeholder={t('energy.searchMeters')}
      />
      {!contractId ? (
        <p>{t('energy.chooseContract')}</p>
      ) : r.error ? (
        <BillingError error={r.error} retry={() => void r.refetch()} />
      ) : !r.data ? (
        <LoadingRows />
      ) : (
        <>
          <Choice
            ariaLabel={t('energy.legacyCandidates')}
            value={selected?.id ?? ''}
            disabled={disabled}
            onChange={(v) => {
              const candidate = r.data?.data.find((x) => x.id === v);
              if (candidate) {
                setSelected(candidate);
                onSelect(candidate);
              }
            }}
            options={r.data.data.map((x) => ({
              value: x.id,
              label:
                x.meterCode +
                ' · ' +
                t('energy.types.' + x.feeType) +
                ' · ' +
                x.start,
            }))}
          />
          <Paged meta={r.data.meta} busy={r.isFetching} onChange={setPage} />
          {!r.data.data.length ? <p>{t('energy.empty')}</p> : null}
        </>
      )}
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
