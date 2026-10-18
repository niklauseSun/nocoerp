import { useState } from 'react';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { useBusinessPermission } from '../hyl/hooks.js';
import { DateField, BillingError } from './common.js';
export function EnergyClosingCheck({
  contractId,
  end,
}: {
  contractId: string;
  end: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    can = useBusinessPermission('contracts', 'terminate'),
    [date, setDate] = useState(end),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [blockers, setBlockers] =
      useState<
        { id: string; number: string; status: string; kind: string }[]
      >();
  if (!can.can) return null;
  async function check() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{
        data: { blockers: NonNullable<typeof blockers> };
      }>({
        path: 'contracts/' + contractId + '/terminationPreview',
        method: 'POST',
        json: { actualEnd: date, closing: true },
      });
      setBlockers(result.data.blockers);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <DateField
          id={'energy-closing-date-' + contractId}
          value={date}
          onChange={(v) => {
            setDate(v);
            setBlockers(undefined);
          }}
          disabled={busy}
        />
        <Button
          variant='outline'
          disabled={busy || !date}
          onClick={() => void check()}
        >
          {busy ? <Spinner /> : null}
          {t('energy.closingCheck')}
        </Button>
      </div>
      {error ? <BillingError error={error} /> : null}
      {blockers ? (
        <div role='status'>
          {blockers.length
            ? blockers.map((b) => (
                <p key={b.kind + ':' + b.id}>
                  {b.number} ·{' '}
                  {t('energy.closing.' + b.status, {
                    defaultValue: t('energy.closing.other'),
                  })}
                </p>
              ))
            : t('energy.closing.clear')}
        </div>
      ) : null}
    </div>
  );
}
