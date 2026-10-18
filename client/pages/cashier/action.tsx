import { useCashierPermission } from './permission.js';
import { useWork } from './work.js';
import { useState, useId } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { useBusinessQuery } from '../hyl/hooks.js';
import { FormField, Confirm, BillingError, LoadingRows } from './common.js';
import type { CashRow } from './types.js';
export default function CashierAction() {
  const { t } = useTranslation(),
    p = useParams(),
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    formId = useId(),
    permission = useCashierPermission('cashierReverse');
  const reverse = l.pathname.endsWith('/reverse'),
    id = reverse ? p.refundId : p.orderId,
    path = reverse ? 'cashierRefunds' : 'cashierOrders',
    label = reverse ? 'reverse' : 'void';
  const [readVersion] = useState(() => crypto.randomUUID()),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [confirm, setConfirm] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const result = useBusinessQuery<{ data: CashRow }>(
    `${path}/${id}`,
    { readVersion },
    permission.can,
  );
  const row = result.data?.data;
  const close = () =>
    void navigate({
      pathname: l.pathname.replace(/\/(reverse|void)$/, ''),
      search: l.search,
    });
  const execute = async () => {
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: CashRow }>({
        path: `${path}/${id}/${label}`,
        method: 'POST',
        json: { requestId, expectedVersion: row!.version, reason, evidence },
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t(reverse ? 'cashier.refundReversed' : 'cashier.orderVoided', {
          number: r.data.number,
        }),
        type: 'success',
      });
      w.setBusy(false);
      close();
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <RouteDialog
      title={t('cashier.confirmation', {
        action: t(`cashier.${label}`),
        number: row?.number ?? '',
      })}
      description={t('cashier.offline')}
      className='sm:max-w-md'
      beforeClose={() => !w.busy}
      footer={
        <>
          <Button variant='outline' disabled={w.busy} onClick={close}>
            {t('cashier.cancel')}
          </Button>
          <Button
            type='submit'
            form={formId}
            disabled={
              w.busy ||
              !row ||
              !permission.can ||
              !row.allowedActions?.includes('cashierReverse')
            }
          >
            {w.busy ? <Spinner /> : null}
            {t(`cashier.${label}`)}
          </Button>
        </>
      }
    >
      {!permission.can ||
      (row && !row.allowedActions?.includes('cashierReverse')) ? (
        <p>{t('billing.restricted')}</p>
      ) : result.error ? (
        <BillingError
          error={result.error}
          retry={() => void result.refetch()}
        />
      ) : !row ? (
        <LoadingRows />
      ) : (
        <form
          id={formId}
          noValidate
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (
              w.focus({
                ...(!reason.trim() ? { reason: t('cashier.required') } : {}),
                ...(!evidence.trim()
                  ? { evidence: t('cashier.required') }
                  : {}),
              })
            )
              setConfirm(true);
          }}
        >
          {w.error ? <BillingError error={w.error} /> : null}
          {w.conflict ? (
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                void result.refetch();
                setRequestId(crypto.randomUUID());
                w.setError(undefined);
              }}
            >
              {t('cashier.reload')}
            </Button>
          ) : null}
          <p className='text-muted-foreground'>
            {t(reverse ? 'cashier.reverseHelp' : 'cashier.voidHelp')}
          </p>
          <FormField
            name='reason'
            label={t('cashier.fields.reason')}
            value={reason}
            onChange={(v) => {
              setReason(v);
              if (w.attempted)
                w.setErrors({
                  ...w.errors,
                  reason: v.trim() ? '' : t('cashier.required'),
                });
            }}
            required
            disabled={w.busy}
            error={w.errors.reason}
          />
          <FormField
            name='evidence'
            label={t('cashier.fields.evidence')}
            value={evidence}
            onChange={(v) => {
              setEvidence(v);
              if (w.attempted)
                w.setErrors({
                  ...w.errors,
                  evidence: v.trim() ? '' : t('cashier.required'),
                });
            }}
            required
            disabled={w.busy}
            error={w.errors.evidence}
          />
        </form>
      )}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t('cashier.confirmation', {
          action: t(`cashier.${label}`),
          number: row?.number,
        })}
        onConfirm={() => void execute()}
        busy={w.busy}
        destructive
        label={t(`cashier.${label}`)}
      >
        {t(reverse ? 'cashier.reverseHelp' : 'cashier.voidHelp')}
      </Confirm>
    </RouteDialog>
  );
}
