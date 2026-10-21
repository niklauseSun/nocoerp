import { RecordSearch } from '#components/record-search';
import { useRecordSearchState } from '#hooks/use-record-search';
import { sourceRecordLabel } from '../hyl/source-record-label.js';
import { formatMoney } from '../billing/format.js';
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
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useBusinessPermission, useBusinessQuery } from '../hyl/hooks.js';
import type { Bill, ListResponse } from '../billing/types.js';
import {
  FormField,
  Group,
  Amounts,
  Footer,
  Confirm,
  RecordPicker,
  Choice,
  DateField,
  Money,
  Paged,
  BillingError,
  LoadingRows,
} from './common.js';
import type { Checkout, Target, Payment, CashRow } from './types.js';
export default function CheckoutPage() {
  const { t } = useTranslation(),
    l = useLocation();
  const p = useParams(),
    path = useResolvedPath('.').pathname,
    permission = useCashierPermission('cashierCheckout');
  const [readVersion] = useState(() => crypto.randomUUID());
  const existing = useBusinessQuery<{ data: CashRow }>(
    `cashierOrders/${p.orderId}`,
    { readVersion },
    !!p.orderId && permission.can,
  );
  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-4xl'>
        {!permission.can ? (
          <>
            <BackButton
              to={{
                pathname: path.replace(/\/(new|cashierNew|edit)$/, ''),
                search: l.search,
              }}
            />
            <p>{t('billing.restricted')}</p>
          </>
        ) : p.orderId && !existing.data ? (
          existing.error ? (
            <BillingError
              error={existing.error}
              retry={() => void existing.refetch()}
            />
          ) : (
            <LoadingRows />
          )
        ) : (
          <CheckoutForm
            key={p.orderId ?? 'new'}
            initial={existing.data?.data}
            path={path}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
function CheckoutForm({ initial, path }: { initial?: CashRow; path: string }) {
  const { t, i18n } = useTranslation(),
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    toaster = useToaster(),
    w = useWork(),
    depositRead = useBusinessPermission('contracts', 'depositRead'),
    depositDeduct = useBusinessPermission('contracts', 'depositDeduct');
  const rawInput = initial?.payload.input as Checkout | undefined;
  const sourceLabels =
    (
      initial?.payload.preview as
        | {
            sources?: {
              billId: string;
              number: string;
              contractNumber: string;
            }[];
          }
        | undefined
    )?.sources ?? [];
  const initialInput = rawInput
    ? {
        ...rawInput,
        targets: rawInput.targets.map((r) => ({
          ...r,
          number: sourceLabels.find((s) => s.billId === r.billId)?.number,
          contractNumber: sourceLabels.find((s) => s.billId === r.billId)
            ?.contractNumber,
        })),
      }
    : undefined;
  const [values, setValues] = useState<Checkout>(
      () =>
        initialInput ?? {
          merchantId: '',
          date: today(),
          notes: '',
          targets: [],
          payments: [],
        },
    ),
    { q, setQ, page, setPage } = useRecordSearchState(
      'cashier-bills:' + values.merchantId,
    ),
    [preview, setPreview] = useState<Record<string, unknown>>(),
    [confirm, setConfirm] = useState(false),
    [discard, setDiscard] = useState(false),
    [pendingMerchant, setPendingMerchant] = useState<string>(),
    [draft, setDraft] = useState(initial),
    [saveId, setSaveId] = useState(() => crypto.randomUUID()),
    [postId, setPostId] = useState(() => crypto.randomUUID()),
    [savedInput, setSavedInput] = useState(
      initialInput ? JSON.stringify(initialInput) : '',
    );
  const bills = useBusinessQuery<ListResponse<Bill>>(
    'bills',
    { merchantId: values.merchantId, status: 'open', q, page, pageSize: 10 },
    !!values.merchantId,
  );
  const parent = path.replace(/\/(new|edit|cashierNew)$/, '');
  const validate = (v = values) => {
    const e: Record<string, string> = {};
    if (!v.merchantId) e.merchantId = t('cashier.required');
    if (!v.targets.length) e.targets = t('cashier.required');
    if (!v.date) e.date = t('cashier.required');
    v.targets.forEach((r, i) => {
      for (const k of ['amount', 'deposit'] as const)
        if (!/^\d{1,12}(\.\d{1,2})?$/.test(r[k]))
          e[`targets.${i}.${k}`] = t('cashier.nonnegative');
      if (Number(r.amount) + Number(r.deposit) <= 0)
        e[`targets.${i}.amount`] = t('cashier.positive');
    });
    v.payments.forEach((r, i) => {
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(r.amount) || Number(r.amount) <= 0)
        e[`payments.${i}.amount`] = t('cashier.positive');
      for (const k of ['reference', 'evidence'] as const)
        if ((k !== 'reference' || r.method === 'bank') && !r[k].trim())
          e[`payments.${i}.${k}`] = t('cashier.required');
      r.splits.forEach((s, j) => {
        if (!/^\d{1,12}(\.\d{1,2})?$/.test(s.amount) || Number(s.amount) <= 0)
          e[`payments.${i}.splits.${j}.amount`] = t('cashier.positive');
      });
    });
    return e;
  };
  const update = (v: Checkout) => {
    if (savedInput) {
      setSavedInput('');
      setSaveId(crypto.randomUUID());
      setPostId(crypto.randomUUID());
    }
    setValues(v);
    setPreview(undefined);
    if (w.attempted) w.setErrors(validate(v));
  };
  const input = () => ({
    merchantId: values.merchantId,
    date: values.date,
    notes: values.notes,
    payments: values.payments,
    targets: values.targets.map(
      ({ number: _number, contractNumber: _contractNumber, ...r }) => r,
    ),
  });
  const close = () => {
    if (w.busy) return;
    if (
      JSON.stringify(values) !==
      JSON.stringify(
        initialInput ?? {
          merchantId: '',
          date: today(),
          notes: '',
          targets: [],
          payments: [],
        },
      )
    ) {
      setDiscard(true);
      return;
    }
    void navigate({ pathname: parent, search: l.search });
  };
  const reload = async () => {
    w.setBusy(true);
    try {
      const targets = await Promise.all(
        values.targets.map(async (r) => {
          const fresh = await api.request<{ data: Bill }>({
            path: `bills/${r.billId}`,
          });
          return {
            ...r,
            expectedBillVersion: fresh.data.version,
            expectedLeaseVersion: fresh.data.lease.version,
          };
        }),
      );
      setValues((v) => ({ ...v, targets }));
      if (draft) {
        const fresh = await api.request<{ data: CashRow }>({
          path: `cashierOrders/${draft.id}`,
        });
        setDraft(fresh.data);
      }
      setPreview(undefined);
      setSaveId(crypto.randomUUID());
      setPostId(crypto.randomUUID());
      w.setError(undefined);
    } catch (e) {
      w.fail(e);
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
        path: 'cashierOrders/preview',
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
  const record = async (post: boolean) => {
    if (!preview) return;
    w.setBusy(true);
    w.setError(undefined);
    let saved = draft;
    try {
      if (!saved || savedInput !== JSON.stringify(input())) {
        const r = await api.request<{ data: CashRow }>({
          path: draft ? `cashierOrders/${draft.id}` : 'cashierOrders',
          method: draft ? 'PATCH' : 'POST',
          json: {
            ...input(),
            requestId: saveId,
            ...(draft ? { expectedVersion: draft.version } : {}),
          },
        });
        saved = r.data;
        setDraft(saved);
        setSavedInput(JSON.stringify(input()));
      }
      if (post) {
        const result = await api.request<{ data: CashRow }>({
          path: `cashierOrders/${saved.id}/post`,
          method: 'POST',
          json: {
            requestId: postId,
            expectedVersion: saved.version,
            reason: t('cashier.post'),
            evidence:
              values.payments.map((p) => p.evidence).join('\n') ||
              t('cashier.fields.deposit'),
          },
        });
        saved = result.data;
      }
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toaster.show({
        title: t(post ? 'cashier.orderPosted' : 'cashier.orderSaved', {
          number: saved.number,
        }),
        type: 'success',
      });
      w.setBusy(false);
      setConfirm(false);
      void navigate({
        pathname: initial
          ? parent
          : path.endsWith('cashierNew')
            ? `${parent}/cashierOrder/${saved.id}`
            : `${parent}/${saved.id}`,
        search: l.search,
      });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
      if (saved && !draft) setDraft(saved);
    } finally {
      w.setBusy(false);
    }
  };
  const addBill = async (b: Bill) => {
    w.setBusy(true);
    try {
      const fresh = await api.request<{ data: Bill }>({
        path: `bills/${b.id}`,
      });
      const target: Target = {
        billId: b.id,
        contractId: b.contractId,
        expectedBillVersion: fresh.data.version,
        expectedLeaseVersion: fresh.data.lease.version,
        amount: (Number(fresh.data.remainingCents) / 100).toFixed(2),
        deposit: '0',
        number: b.number,
        contractNumber: scalar(fresh.data.payload.contract.number),
      };
      update({
        ...values,
        targets: [...values.targets, target],
        payments: values.payments.map((p) =>
          p.splits.some((s) => s.contractId === b.contractId)
            ? p
            : {
                ...p,
                splits: [
                  ...p.splits,
                  { contractId: b.contractId, amount: '0' },
                ],
              },
        ),
      });
    } catch (e) {
      w.fail(e);
      setConfirm(false);
    } finally {
      w.setBusy(false);
    }
  };
  const changeTarget = (
    index: number,
    key: 'amount' | 'deposit',
    value: string,
  ) =>
    update({
      ...values,
      targets: values.targets.map((r, i) =>
        i === index ? { ...r, [key]: value } : r,
      ),
    });
  const changePayment = (index: number, patch: Partial<Payment>) =>
    update({
      ...values,
      payments: values.payments.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    });
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
        title={
          initial
            ? t('cashier.editTitle', { number: initial.number })
            : t('cashier.newOrder')
        }
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
          <Alert>
            <AlertDescription>
              {t('cashier.changed')}
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() => void reload()}
              >
                {t('cashier.reload')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Group title={t('cashier.fields.merchant')}>
          <Field>
            <FieldLabel htmlFor='cashier-merchantId'>
              {t('cashier.fields.merchant')} *
            </FieldLabel>
            <RecordPicker
              kind='merchants'
              id='cashier-merchantId'
              value={values.merchantId}
              disabled={w.busy || !!initial}
              onChange={(id) => {
                if (values.targets.length) {
                  setPendingMerchant(id);
                  setDiscard(true);
                } else update({ ...values, merchantId: id });
              }}
            />
            {w.errors.merchantId ? (
              <FieldError>{w.errors.merchantId}</FieldError>
            ) : null}
          </Field>
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
          <FormField
            name='notes'
            label={t('cashier.fields.notes')}
            value={values.notes}
            onChange={(notes) => update({ ...values, notes })}
            error={w.errors.notes}
            multiline
            disabled={w.busy}
          />
        </Group>
        <Group title={t('cashier.selected')}>
          <RecordSearch
            id='cashier-bill-source'
            label={t('cashier.selected')}
            value=''
            scopeKey={'cashier-bills:' + values.merchantId}
            hasSelection={!!values.targets.length}
            onClear={() =>
              update({
                ...values,
                targets: [],
                payments: values.payments.map((payment) => ({
                  ...payment,
                  splits: [],
                })),
              })
            }
            disabled={w.busy || !values.merchantId}
            loading={bills.isFetching}
            options={(bills.isPlaceholderData || values.targets.length >= 50
              ? []
              : (bills.data?.data ?? [])
            )
              .filter((b) => !values.targets.some((r) => r.billId === b.id))
              .map((b) => ({
                value: b.id,
                label:
                  sourceRecordLabel(b) +
                  ' · ' +
                  formatMoney(b.remainingCents, i18n.language, true),
              }))}
            onChange={(id) => {
              if (w.busy || values.targets.length >= 50) return;
              const b = bills.data?.data.find((row) => row.id === id);
              if (b && !values.targets.some((r) => r.billId === id))
                void addBill(b);
            }}
            onSearch={(query) => {
              setQ(query);
              setPage(1);
            }}
            placeholder={t('hyl.copy.sourceSearch')}
            status={
              bills.error ? (
                <BillingError
                  error={bills.error}
                  retry={() => void bills.refetch()}
                />
              ) : values.targets.length >= 50 ? (
                <p role='status'>{t('hyl.copy.sourceLimit', { count: 50 })}</p>
              ) : undefined
            }
            footer={
              bills.data && bills.data.meta.total > 10 ? (
                <Paged
                  meta={bills.data.meta}
                  busy={w.busy || bills.isFetching}
                  onChange={setPage}
                />
              ) : undefined
            }
          />
          {w.errors.targets ? (
            <FieldError id='cashier-targets' tabIndex={-1}>
              {w.errors.targets}
            </FieldError>
          ) : null}
          {values.targets.map((r, i) => (
            <div
              key={r.billId}
              className='flex flex-col gap-3 rounded-lg border p-4'
            >
              <span className='font-medium'>
                {r.number || r.billId} · {r.contractNumber || r.contractId}
              </span>
              <div className='grid gap-3 sm:grid-cols-2'>
                {(['amount', 'deposit'] as const).map((key) => (
                  <FormField
                    key={key}
                    name={`targets.${i}.${key}`}
                    label={t(`cashier.fields.${key}`)}
                    value={r[key]}
                    onChange={(v) => changeTarget(i, key, v)}
                    required={key === 'amount'}
                    disabled={
                      w.busy ||
                      (key === 'deposit' &&
                        !(depositRead.can && depositDeduct.can))
                    }
                    error={w.errors[`targets.${i}.${key}`]}
                    decimal
                  />
                ))}
              </div>
            </div>
          ))}
        </Group>
        <Group title={t('cashier.payments')}>
          {values.payments.map((p, i) => (
            <div
              key={p.key}
              className='flex flex-col gap-4 rounded-lg border p-4'
            >
              <Field>
                <FieldLabel>{t('cashier.fields.method')} *</FieldLabel>
                <Choice
                  ariaLabel={t('cashier.fields.method')}
                  value={p.method}
                  onChange={(v) =>
                    changePayment(i, { method: v as Payment['method'] })
                  }
                  disabled={w.busy}
                  options={['bank', 'cash', 'other'].map((value) => ({
                    value,
                    label: t(`cashier.methods.${value}`),
                  }))}
                />
              </Field>
              {(['amount', 'reference', 'evidence'] as const).map((key) => (
                <FormField
                  key={key}
                  name={`payments.${i}.${key}`}
                  label={t(`cashier.fields.${key}`)}
                  value={p[key]}
                  required={key !== 'reference' || p.method === 'bank'}
                  disabled={w.busy}
                  decimal={key === 'amount'}
                  error={w.errors[`payments.${i}.${key}`]}
                  onChange={(v) => changePayment(i, { [key]: v })}
                />
              ))}
              {p.splits.map((s, j) => (
                <div key={s.contractId} className='flex flex-col gap-2'>
                  <FormField
                    name={`payments.${i}.splits.${j}.amount`}
                    label={`${t('cashier.fields.contractSplit')} · ${values.targets.find((r) => r.contractId === s.contractId)?.contractNumber || s.contractId}`}
                    value={s.amount}
                    required
                    decimal
                    disabled={w.busy}
                    error={w.errors[`payments.${i}.splits.${j}.amount`]}
                    onChange={(v) =>
                      changePayment(i, {
                        splits: p.splits.map((s, k) =>
                          j === k ? { ...s, amount: v } : s,
                        ),
                      })
                    }
                  />
                  <Button
                    type='button'
                    variant='outline'
                    disabled={w.busy}
                    aria-label={`${t('cashier.remove')} ${values.targets.find((r) => r.contractId === s.contractId)?.contractNumber || s.contractId}`}
                    onClick={() =>
                      changePayment(i, {
                        splits: p.splits.filter(
                          (r) => r.contractId !== s.contractId,
                        ),
                      })
                    }
                  >
                    {t('cashier.remove')}
                  </Button>
                </div>
              ))}
              {values.targets
                .filter(
                  (r, index, rows) =>
                    rows.findIndex((t) => t.contractId === r.contractId) ===
                      index &&
                    !p.splits.some((s) => s.contractId === r.contractId),
                )
                .map((r) => (
                  <Button
                    key={r.contractId}
                    type='button'
                    variant='outline'
                    disabled={w.busy}
                    onClick={() =>
                      changePayment(i, {
                        splits: [
                          ...p.splits,
                          { contractId: r.contractId, amount: '' },
                        ],
                      })
                    }
                  >
                    {t('cashier.select')} · {r.contractNumber || r.contractId}
                  </Button>
                ))}
              <Button
                type='button'
                variant='outline'
                disabled={w.busy}
                onClick={() =>
                  update({
                    ...values,
                    payments: values.payments.filter((r) => r.key !== p.key),
                  })
                }
              >
                {t('cashier.remove')}
              </Button>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={
              w.busy || !values.targets.length || values.payments.length >= 10
            }
            onClick={() =>
              update({
                ...values,
                payments: [
                  ...values.payments,
                  {
                    key: crypto.randomUUID(),
                    method: 'bank',
                    amount: '',
                    reference: '',
                    evidence: '',
                    splits: [
                      ...new Set(values.targets.map((t) => t.contractId)),
                    ].map((contractId) => ({ contractId, amount: '' })),
                  },
                ],
              })
            }
          >
            {t('cashier.addPayment')}
          </Button>
        </Group>
        {preview ? (
          <>
            {' '}
            <Group title={t('cashier.contractPreview')}>
              {(
                (preview.contracts ?? []) as {
                  contractId: string;
                  receivedCents: string;
                  allocatedCents: string;
                  depositCents: string;
                  unusedCents: string;
                }[]
              ).map((c) => (
                <div key={c.contractId} className='flex flex-col gap-2'>
                  <span>
                    {values.targets.find((r) => r.contractId === c.contractId)
                      ?.contractNumber || c.contractId}
                  </span>
                  <Amounts
                    values={{
                      receivedCents: c.receivedCents,
                      allocatedCents: c.allocatedCents,
                      depositCents: c.depositCents,
                      unusedCents: c.unusedCents,
                    }}
                  />
                </div>
              ))}
            </Group>
            <Amounts
              values={Object.fromEntries(
                [
                  'receivedCents',
                  'allocatedCents',
                  'depositCents',
                  'unusedCents',
                ].map((k) => [k, scalar(preview[k] ?? '0')]),
              )}
            />
          </>
        ) : null}
        <Footer
          busy={w.busy}
          onCancel={close}
          onPreview={() => void previewNow()}
          onSave={() => void record(false)}
          reviewed={!!preview}
          label={t('cashier.post')}
        />
      </form>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t('cashier.confirmation', {
          action: t('cashier.post'),
          number: draft?.number || t('cashier.newOrder'),
        })}
        onConfirm={() => void record(true)}
        busy={w.busy}
        label={t('cashier.post')}
      >
        {t('cashier.offline')}{' '}
        <Money cents={scalar(preview?.receivedCents ?? 0)} /> ·{' '}
        {t('cashier.fields.unusedCents')}{' '}
        <Money cents={scalar(preview?.unusedCents ?? 0)} />
      </Confirm>
      <Confirm
        open={discard}
        onOpenChange={(open) => {
          setDiscard(open);
          if (!open) setPendingMerchant(undefined);
        }}
        title={t('cashier.discardTitle')}
        onConfirm={() => {
          setDiscard(false);
          if (pendingMerchant !== undefined) {
            update({
              ...values,
              merchantId: pendingMerchant,
              targets: [],
              payments: [],
            });
            setPendingMerchant(undefined);
          } else void navigate({ pathname: parent, search: l.search });
        }}
        busy={w.busy}
        destructive
        label={t('cashier.discard')}
      >
        {t('cashier.discardDescription')}
      </Confirm>
    </>
  );
}
