import { useCashierPermission } from './permission.js';
import { scalar } from '../hyl/model.js';
import { today } from './helpers.js';
import { useWork } from './work.js';
import { useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import type {
  Bill,
  Receipt,
  LedgerEntry,
  ListResponse,
} from '../billing/types.js';
import {
  FormField,
  Group,
  Amounts,
  Footer,
  Confirm,
  RecordPicker,
  DateField,
  Money,
  Search,
  Paged,
  BillingError,
  LoadingRows,
} from './common.js';
import type { CashRow, RefundInput, RefundSource } from './types.js';
export default function RefundPage() {
  const params = useParams(),
    can = useCashierPermission('cashierRefund');
  const order = useBusinessQuery<{ data: CashRow }>(
    `cashierOrders/${params.orderId}`,
    undefined,
    !!params.orderId && can.can,
  );
  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        {!can.can ? (
          <p>
            <Restricted />
          </p>
        ) : params.orderId && !order.data ? (
          order.error ? (
            <BillingError
              error={order.error}
              retry={() => void order.refetch()}
            />
          ) : (
            <LoadingRows />
          )
        ) : (
          <RefundForm merchant={order.data?.data.merchantId} />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function Restricted() {
  const { t } = useTranslation();
  return t('billing.restricted');
}
function RefundForm({ merchant }: { merchant?: string }) {
  const { t } = useTranslation(),
    l = useLocation(),
    navigate = useNavigate(),
    path = useResolvedPath('.').pathname,
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    reverse = useBusinessPermission('contracts', 'receiptReverse'),
    allocate = useBusinessPermission('contracts', 'receiptAllocate'),
    billRead = useBusinessPermission('contracts', 'billingRead');
  const [merchantId, setMerchantId] = useState(merchant ?? ''),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [values, setValues] = useState<RefundInput>(() => ({
      date: today(),
      reference: '',
      reason: '',
      evidence: '',
      notes: '',
      sources: [],
    })),
    [selected, setSelected] = useState<
      Record<
        string,
        Receipt & {
          entries: LedgerEntry[];
          entriesMeta?: { page: number; pageSize: number; total: number };
        }
      >
    >({}),
    [preview, setPreview] = useState<Record<string, unknown>>(),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false);
  const parent = path.replace(/\/(new|refundNew)$/, '');
  const receipts = useBusinessQuery<ListResponse<Receipt>>(
    'receipts',
    { merchantId, q, page, pageSize: 10 },
    !!merchantId,
  );
  const validate = (v = values) => {
    const e: Record<string, string> = {};
    if (!v.sources.length) e.sources = t('cashier.required');
    for (const k of ['date', 'reference', 'reason', 'evidence'] as const)
      if (!v[k].trim()) e[k] = t('cashier.required');
    v.sources.forEach((s, i) => {
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(s.amount) || Number(s.amount) <= 0)
        e[`sources.${i}.amount`] = t('cashier.positive');
      s.allocations.forEach((a, j) => {
        if (!/^\d{1,12}(\.\d{1,2})?$/.test(a.amount) || Number(a.amount) <= 0)
          e[`sources.${i}.allocations.${j}.amount`] = t('cashier.positive');
      });
    });
    return e;
  };
  const update = (v: RefundInput) => {
    setValues(v);
    setPreview(undefined);
    if (w.attempted) w.setErrors(validate(v));
  };
  const input = () => ({
    ...values,
    requestId,
    sources: values.sources.map(({ number: _number, ...r }) => r),
  });
  const close = () => {
    if (w.busy) return;
    if (values.sources.length || values.reference || values.reason) {
      setDiscard(true);
      return;
    }
    void navigate({ pathname: parent, search: l.search });
  };
  const add = async (r: Receipt) => {
    w.setBusy(true);
    try {
      const fresh = await api.request<{
        data: Receipt & { entries: LedgerEntry[] };
      }>({ path: `receipts/${r.id}` });
      setSelected((old) => ({ ...old, [r.id]: fresh.data }));
      update({
        ...values,
        sources: [
          ...values.sources,
          {
            receiptId: r.id,
            expectedVersion: fresh.data.version,
            amount:
              BigInt(fresh.data.unusedCents) > 0n
                ? (Number(fresh.data.unusedCents) / 100).toFixed(2)
                : '',
            method: fresh.data.payload.method as RefundSource['method'],
            allocations: [],
            number: r.number,
          },
        ],
      });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const entryPage = async (id: string, page: number) => {
    w.setBusy(true);
    try {
      const r = await api.request<{
        data: Receipt & {
          entries: LedgerEntry[];
          entriesMeta: { page: number; pageSize: number; total: number };
        };
      }>({ path: `receipts/${id}`, query: { ledgerPage: page } });
      setSelected((old) => ({ ...old, [id]: r.data }));
    } catch (e) {
      w.fail(e);
    } finally {
      w.setBusy(false);
    }
  };
  const changeSource = (i: number, patch: Partial<RefundSource>) =>
    update({
      ...values,
      sources: values.sources.map((s, j) => (i === j ? { ...s, ...patch } : s)),
    });
  const toggleAllocation = async (
    i: number,
    e: LedgerEntry,
    checked: boolean,
  ) => {
    const s = values.sources[i];
    if (!checked) {
      changeSource(i, {
        allocations: s.allocations.filter((a) => a.entryId !== e.id),
      });
      return;
    }
    w.setBusy(true);
    try {
      const bill = await api.request<{ data: Bill }>({
        path: `bills/${e.billId}`,
      });
      changeSource(i, {
        allocations: [
          ...s.allocations,
          {
            entryId: e.id,
            amount: (Number(e.amountCents) / 100).toFixed(2),
            expectedBillVersion: bill.data.version,
          },
        ],
      });
    } catch (error) {
      w.fail(error);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const previewNow = async () => {
    if (!w.focus(validate())) return;
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: Record<string, unknown> }>({
        path: 'cashierRefunds/preview',
        method: 'POST',
        json: input(),
      });
      setPreview(r.data);
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const reload = async () => {
    w.setBusy(true);
    try {
      const sources = await Promise.all(
        values.sources.map(async (s) => {
          const r = await api.request<{
            data: Receipt & { entries: LedgerEntry[] };
          }>({ path: `receipts/${s.receiptId}` });
          setSelected((old) => ({ ...old, [s.receiptId]: r.data }));
          return {
            ...s,
            expectedVersion: r.data.version,
            allocations: await Promise.all(
              s.allocations.map(async (a) => {
                const entry = r.data.entries.find((e) => e.id === a.entryId);
                if (!entry?.billId) return a;
                const b = await api.request<{ data: Bill }>({
                  path: `bills/${entry.billId}`,
                });
                return { ...a, expectedBillVersion: b.data.version };
              }),
            ),
          };
        }),
      );
      setValues((v) => ({ ...v, sources }));
      setRequestId(crypto.randomUUID());
      setPreview(undefined);
      w.setError(undefined);
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const record = async () => {
    w.setBusy(true);
    w.setError(undefined);
    try {
      const r = await api.request<{ data: CashRow }>({
        path: 'cashierRefunds',
        method: 'POST',
        json: input(),
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t('cashier.refundPosted', { number: r.data.number }),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      void navigate({
        pathname: path.endsWith('refundNew')
          ? `${parent}/refund/${r.data.id}`
          : `${parent}/${r.data.id}`,
        search: l.search,
      });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  return (
    <>
      <BackButton
        to={{ pathname: parent, search: l.search }}
        onClick={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <PageHeader
        title={t('cashier.newRefund')}
        description={t('cashier.offline')}
      />
      <form
        noValidate
        className='flex flex-col gap-6'
        onSubmit={(e) => {
          e.preventDefault();
          if (preview) setConfirm(true);
          else void previewNow();
        }}
      >
        {w.error ? <BillingError error={w.error} /> : null}
        {w.conflict ? (
          <Button
            type='button'
            variant='outline'
            disabled={w.busy}
            onClick={() => void reload()}
          >
            {t('cashier.reload')}
          </Button>
        ) : null}
        <p className='text-sm text-muted-foreground'>
          {t('cashier.refundHelp')}
        </p>
        <Group title={t('cashier.sources')}>
          <Field>
            <FieldLabel htmlFor='cashier-merchantId'>
              {t('cashier.fields.merchant')} *
            </FieldLabel>
            <RecordPicker
              id='cashier-merchantId'
              kind='merchants'
              value={merchantId}
              disabled={w.busy || !!merchant || !!values.sources.length}
              onChange={setMerchantId}
            />
          </Field>
          <Search
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder={t('cashier.receiptSearch')}
          />
          {receipts.error ? (
            <BillingError
              error={receipts.error}
              retry={() => void receipts.refetch()}
            />
          ) : merchantId && !receipts.data ? (
            <LoadingRows />
          ) : null}
          {receipts.data?.data
            .filter((r) => r.status !== 'voided')
            .map((r) => (
              <label className='flex flex-wrap items-center gap-3' key={r.id}>
                <Checkbox
                  checked={values.sources.some((s) => s.receiptId === r.id)}
                  disabled={
                    w.busy ||
                    (values.sources.length >= 20 &&
                      !values.sources.some((s) => s.receiptId === r.id))
                  }
                  onCheckedChange={(checked) => {
                    if (checked) void add(r);
                    else
                      update({
                        ...values,
                        sources: values.sources.filter(
                          (s) => s.receiptId !== r.id,
                        ),
                      });
                  }}
                />
                <span>{r.number}</span>
                <span className='text-muted-foreground'>
                  {t('cashier.fields.unusedCents')}
                </span>
                <Money cents={r.unusedCents} />
              </label>
            ))}
          {receipts.data ? (
            <Paged
              meta={receipts.data.meta}
              busy={w.busy || receipts.isFetching}
              onChange={setPage}
            />
          ) : null}
          {w.errors.sources ? (
            <FieldError id='cashier-sources' tabIndex={-1}>
              {w.errors.sources}
            </FieldError>
          ) : null}
          {values.sources.map((s, i) => (
            <div
              className='flex flex-col gap-4 rounded-lg border p-4'
              key={s.receiptId}
            >
              <span>
                {s.number || s.receiptId} · {t(`cashier.methods.${s.method}`)}
              </span>
              <FormField
                name={`sources.${i}.amount`}
                label={t('cashier.fields.amountCents')}
                value={s.amount}
                required
                decimal
                disabled={w.busy}
                error={w.errors[`sources.${i}.amount`]}
                onChange={(amount) => changeSource(i, { amount })}
              />
              {selected[s.receiptId]?.entriesMeta ? (
                <Paged
                  meta={selected[s.receiptId].entriesMeta}
                  busy={w.busy}
                  onChange={(page) => void entryPage(s.receiptId, page)}
                />
              ) : null}
              {(reverse.can &&
              allocate.can &&
              billRead.can &&
              ['receiptReverse', 'receiptAllocate', 'billingRead'].every(
                (action) =>
                  selected[s.receiptId]?.allowedActions.includes(action),
              )
                ? (selected[s.receiptId]?.entries ?? [])
                : []
              )
                .filter((e) => e.kind === 'allocate' && !e.reversed)
                .map((e) => {
                  const a = s.allocations.find((a) => a.entryId === e.id),
                    j = s.allocations.findIndex((a) => a.entryId === e.id);
                  return (
                    <div key={e.id} className='flex flex-col gap-2'>
                      <label className='flex flex-wrap items-center gap-2'>
                        <Checkbox
                          checked={!!a}
                          disabled={w.busy}
                          onCheckedChange={(v) =>
                            void toggleAllocation(i, e, !!v)
                          }
                        />
                        <span>
                          {t('cashier.allocateRefund')} ·{' '}
                          {e.sourceNumber || e.billId}
                        </span>
                        <Money cents={e.amountCents} />
                      </label>
                      {a ? (
                        <FormField
                          name={`sources.${i}.allocations.${j}.amount`}
                          label={t('cashier.fields.restoredCents')}
                          value={a.amount}
                          required
                          decimal
                          disabled={w.busy}
                          error={
                            w.errors[`sources.${i}.allocations.${j}.amount`]
                          }
                          onChange={(amount) =>
                            changeSource(i, {
                              allocations: s.allocations.map((r) =>
                                r.entryId === e.id ? { ...r, amount } : r,
                              ),
                            })
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ))}
        </Group>
        <Group title={t('cashier.history')}>
          <Field>
            <FieldLabel htmlFor='cashier-date'>
              {t('cashier.fields.date')} *
            </FieldLabel>
            <DateField
              id='cashier-date'
              value={values.date}
              onChange={(date) => update({ ...values, date })}
              disabled={w.busy}
            />
          </Field>
          {(['reference', 'reason', 'evidence', 'notes'] as const).map((k) => (
            <FormField
              key={k}
              name={k}
              label={t(`cashier.fields.${k}`)}
              value={values[k]}
              required={k !== 'notes'}
              disabled={w.busy}
              multiline={k === 'notes'}
              error={w.errors[k]}
              onChange={(v) => update({ ...values, [k]: v })}
            />
          ))}
        </Group>
        {preview ? (
          <Amounts
            values={{
              amountCents: scalar(preview.amountCents),
              restoredCents: scalar(preview.restoredCents),
            }}
          />
        ) : null}
        <Footer
          busy={w.busy}
          onCancel={close}
          onPreview={() => void previewNow()}
          reviewed={!!preview}
          label={t('cashier.refund')}
        />
      </form>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t('cashier.confirmation', {
          action: t('cashier.refund'),
          number: values.reference,
        })}
        busy={w.busy}
        onConfirm={() => void record()}
        destructive
        label={t('cashier.refund')}
      >
        {t('cashier.refundHelp')} ·{' '}
        <Money cents={scalar(preview?.amountCents ?? 0)} /> ·{' '}
        {t('cashier.fields.restoredCents')}{' '}
        <Money cents={scalar(preview?.restoredCents ?? 0)} />
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={setDiscard}
        title={t('cashier.discardTitle')}
        onConfirm={() => void navigate({ pathname: parent, search: l.search })}
        busy={w.busy}
        destructive
        label={t('cashier.discard')}
      >
        {t('cashier.discardDescription')}
      </Confirm>
    </>
  );
}
