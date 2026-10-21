import { endpoint, str, today } from './helpers.js';
import { fieldMessages } from '../billing/form-errors.js';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useParams,
  useResolvedPath,
  useLocation,
  useNavigate,
} from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useWork } from '../cashier/work.js';
import { useLeave } from '../inspections/leave.js';
import {
  supplierValues,
  requestValues,
  receiptValues,
  supplierAction,
  requestAction,
  orderAction,
  receiptAction,
  paymentAction,
} from '../../../server/procurement/schema.js';
import {
  TextField,
  Picker,
  Choice,
  Group,
  Money,
  Confirm,
  BillingError,
  LoadingRows,
  type Kind,
  type Row,
  type Item,
} from './common.js';
interface FormValues {
  [key: string]: string | DraftItem[] | Price[] | ReceiptLine[] | undefined;
  name: string;
  projectId: string;
  contact: string;
  phone: string;
  supplyScope: string;
  address: string;
  taxNumber: string;
  qualificationUntil: string;
  notes: string;
  title: string;
  assetId: string;
  repairId: string;
  neededOn: string;
  reason: string;
  note: string;
  supplierId: string;
  day: string;
  evidence: string;
  amount: string;
  reference: string;
  channel: string;
  items: DraftItem[];
  prices?: Price[];
  lines: ReceiptLine[];
}
type DraftItem = {
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: string;
};
type Price = { itemId: string; unitPrice: string };
type ReceiptLine = { itemId: string; delivered: number; accepted: number };
const initialItem = () => ({
  name: '',
  spec: '',
  unit: '',
  quantity: 1,
  unitPrice: '',
});
export default function Form({ kind }: { kind: Kind }) {
  const { t } = useTranslation(),
    params = useParams(),
    path = useResolvedPath('.').pathname,
    l = useLocation(),
    navigate = useNavigate(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    w = useWork(),
    mode =
      params.purchaseAction || (path.endsWith('/newReceipt') ? 'new' : 'new'),
    id = params['purchase' + kind + 'Id'],
    isNew = mode === 'new',
    newReceipt = isNew && kind === 'receipts',
    parentId = params.purchaseordersId,
    back = { pathname: path.slice(0, path.lastIndexOf('/')), search: l.search },
    big = ['edit', 'new'].includes(mode);
  const result = useBusinessQuery<{ data: Row }>(
      endpoint(newReceipt ? 'orders' : kind) +
        '/' +
        (newReceipt ? parentId : id),
      undefined,
      !isNew || newReceipt,
    ),
    repair = useBusinessQuery<{
      data: { assetId: string; payload: Record<string, unknown> };
    }>(
      'repairOrders/' + params.repairId,
      undefined,
      !!params.repairId && isNew && kind === 'requests',
    ),
    r = result.data?.data;
  const [values, setValues] = useState<FormValues>({
      name: '',
      projectId: '',
      contact: '',
      phone: '',
      supplyScope: '',
      address: '',
      taxNumber: '',
      qualificationUntil: '',
      notes: '',
      title: '',
      assetId: '',
      repairId: '',
      neededOn: today(),
      reason: '',
      items: [initialItem()],
      note: '',
      supplierId: '',
      day: today(),
      evidence: '',
      amount: '',
      reference: '',
      channel: 'bank',
      lines: [],
    }),
    [baseline, setBaseline] = useState(''),
    [loaded, setLoaded] = useState(false),
    [confirm, setConfirm] = useState(false),
    [uncertain, setUncertain] = useState(false),
    pendingRef = useRef<{ path: string; json: unknown } | undefined>(undefined),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [frozenVersion, setFrozenVersion] = useState(0);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || loaded) return;
      if ((!isNew || newReceipt) && (!r || !result.isFetchedAfterMount)) return;
      if (isNew && params.repairId && !repair.data) return;
      let v = { ...values };
      if (isNew && params.repairId && repair.data)
        v = {
          ...v,
          assetId: repair.data.data.assetId,
          repairId: params.repairId,
        };
      if (r) {
        setFrozenVersion(r.version);
        if (newReceipt)
          v = {
            ...v,
            orderId: r.id,
            lines: (r.payload.items as Item[]).map((i) => ({
              itemId: i.id,
              delivered: Math.max(
                0,
                i.quantity -
                  Number(
                    (r.payload.received as Record<string, number>)?.[i.id] ?? 0,
                  ),
              ),
              accepted: Math.max(
                0,
                i.quantity -
                  Number(
                    (r.payload.received as Record<string, number>)?.[i.id] ?? 0,
                  ),
              ),
            })),
          };
        else if (mode === 'edit')
          v = {
            ...v,
            ...r.payload,
            name: r.title,
            title: r.title,
            prices: (r.payload.items as Item[] | undefined)?.map((i) => ({
              itemId: i.id,
              unitPrice: i.unitPrice,
            })),
          };
      }
      setValues(v);
      setBaseline(JSON.stringify(v));
      setLoaded(true);
    });
    return () => {
      active = false;
    };
    // Freeze one fresh baseline. Refetches must not replace entered data or silently advance its version.
  }, [
    loaded,
    r,
    result.isFetchedAfterMount,
    repair.data,
    isNew,
    params.repairId,
    mode,
    newReceipt,
    values,
  ]);
  const leave = useLeave(loaded && JSON.stringify(values) !== baseline, w.busy);
  const set = useCallback(
    (k: string, v: FormValues[string]) => {
      pendingRef.current = undefined;
      w.setError(undefined);
      w.setErrors({});
      setValues((old) => ({ ...old, [k]: v }));
    },
    [w],
  );
  const fields = (names: string[], v: object = values) =>
    Object.fromEntries(
      names.map((k) => [k, (v as Record<string, unknown>)[k] ?? '']),
    );
  function body() {
    if (isNew) {
      if (kind === 'suppliers')
        return {
          requestId,
          values: fields([
            'projectId',
            'name',
            'contact',
            'phone',
            'address',
            'supplyScope',
            'taxNumber',
            'qualificationUntil',
            'notes',
          ]),
        };
      if (kind === 'requests')
        return {
          requestId,
          values: {
            ...fields([
              'title',
              'assetId',
              'repairId',
              'neededOn',
              'reason',
              'notes',
            ]),
            items: values.items,
          },
        };
      return {
        requestId,
        expectedOrderVersion: frozenVersion,
        values: {
          ...fields(['orderId', 'day', 'evidence', 'notes']),
          lines: values.lines.filter((i) => i.delivered > 0),
        },
      };
    }
    const base = { requestId, expectedVersion: frozenVersion, action: mode };
    if (mode === 'edit') {
      if (kind === 'suppliers')
        return {
          ...base,
          values: fields([
            'name',
            'contact',
            'phone',
            'address',
            'supplyScope',
            'taxNumber',
            'qualificationUntil',
            'notes',
          ]),
        };
      if (kind === 'requests')
        return {
          ...base,
          values: {
            ...fields(['title', 'neededOn', 'reason', 'notes']),
            items: values.items.map((i) =>
              fields(['name', 'spec', 'unit', 'quantity', 'unitPrice'], i),
            ),
          },
        };
      if (kind === 'orders') return { ...base, prices: values.prices };
      return {
        ...base,
        values: {
          ...fields(['day', 'evidence', 'notes']),
          lines: values.lines.map((i) =>
            fields(['itemId', 'delivered', 'accepted'], i),
          ),
        },
      };
    }
    return {
      ...base,
      ...fields(
        mode === 'convert'
          ? ['supplierId', 'note']
          : mode === 'pay'
            ? ['amount', 'day', 'reference', 'channel', 'evidence', 'note']
            : mode === 'reverse'
              ? ['day', 'note']
              : ['note'],
      ),
    };
  }
  const schema = isNew
    ? kind === 'suppliers'
      ? supplierValues
      : kind === 'requests'
        ? requestValues
        : receiptValues
    : kind === 'suppliers'
      ? supplierAction
      : kind === 'requests'
        ? requestAction
        : kind === 'orders'
          ? orderAction
          : kind === 'receipts'
            ? receiptAction
            : paymentAction;
  const errorsFor = () => {
    const b = body(),
      parsed = schema.safeParse(isNew ? (b as { values: unknown }).values : b),
      errors: Record<string, string> = {};
    if (!parsed.success)
      for (const i of parsed.error.issues) {
        const key = i.path.filter((v) => v !== 'values').join('.');
        if (!errors[key]) {
          const leaf = String(i.path.at(-1) ?? '');
          errors[key] = t(
            'procurement.validation.' +
              (i.message === 'REJECTED_GOODS_NOTE_REQUIRED'
                ? 'rejectionNote'
                : i.message === 'INVALID_QUANTITY'
                  ? 'accepted'
                  : i.code === 'too_small' &&
                      'minimum' in i &&
                      i.minimum === 1 &&
                      i.path.length === 1 &&
                      leaf === 'items'
                    ? 'items'
                    : ['unitPrice', 'amount'].includes(leaf)
                      ? 'money'
                      : ['quantity', 'delivered'].includes(leaf)
                        ? 'quantity'
                        : leaf === 'accepted'
                          ? 'accepted'
                          : ['day', 'neededOn', 'qualificationUntil'].includes(
                                leaf,
                              )
                            ? 'date'
                            : leaf === 'taxNumber'
                              ? 'tax'
                              : 'required'),
          );
        }
      }
    return errors;
  };
  const shown = w.attempted ? errorsFor() : {};
  const field = (
    name: string,
    required = false,
    multiline = false,
    type = 'text',
  ) => (
    <TextField
      key={name}
      name={name}
      value={str(values[name])}
      onChange={(v) => set(name, v)}
      required={required}
      multiline={multiline}
      type={type}
      error={shown[name] || w.errors[name]}
    />
  );
  const submit = () => {
    if (w.busy) return;
    const e = errorsFor();
    if (!w.focus(e)) return;
    setConfirm(true);
  };
  async function send() {
    if (w.busy) return;
    setConfirm(false);
    w.setBusy(true);
    w.setError(undefined);
    pendingRef.current ??= {
      path: endpoint(kind) + (isNew ? '' : '/' + id + '/actions'),
      json: body(),
    };
    try {
      const out = await api.request<{ data: Row }>({
        ...pendingRef.current,
        method: 'POST',
      });
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      leave.allow();
      w.setBusy(false);
      toast.show({
        title: t('procurement.success', {
          action: t('procurement.actions.' + (isNew ? 'create' : mode)),
          record: out.data.number + ' · ' + out.data.title,
        }),
      });
      void navigate(
        isNew
          ? {
              pathname:
                back.pathname + (newReceipt ? '/receipts/' : '/') + out.data.id,
              search: l.search,
            }
          : back,
      );
    } catch (e) {
      setUncertain(!(e instanceof ApiClientError) || e.status >= 500);
      if (e instanceof ApiClientError && e.status < 500)
        pendingRef.current = undefined;
      w.fail(e);
      const mapped = Object.fromEntries(
        Object.entries(fieldMessages(e, t)).map(([k, v]) => [
          k.replace(/^values\./, ''),
          v,
        ]),
      );
      if (Object.keys(mapped).length) w.focus(mapped);
    } finally {
      w.setBusy(false);
    }
  }
  const title =
    t('procurement.actions.' + (isNew ? 'create' : mode)) +
    ' · ' +
    (r
      ? r.number + ' · ' + r.title
      : str(values.title) || str(values.name) || t('procurement.' + kind));
  const ready = loaded && (!r || r.version === frozenVersion),
    unauthorized = !isNew && r && !r.allowedActions.includes(mode),
    content = (
      <>
        {result.error || repair.error ? (
          <BillingError
            error={result.error ?? repair.error}
            retry={() => {
              if (result.error) void result.refetch();
              else void repair.refetch();
            }}
          />
        ) : !loaded ? (
          <LoadingRows />
        ) : (
          <form
            id='procurement-form'
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className='flex flex-col gap-5'
          >
            {w.error ? <BillingError error={w.error} /> : null}
            <fieldset
              disabled={w.busy || uncertain || !ready || unauthorized}
              className='flex min-w-0 flex-col gap-5'
            >
              {unauthorized ? <p>{t('procurement.noAccess')}</p> : null}
              {r?.blockedActions[mode] ? (
                <p>{t('procurement.errors.' + r.blockedActions[mode])}</p>
              ) : null}
              {(isNew || mode === 'edit') && kind === 'suppliers' ? (
                <Group title={t('procurement.suppliers')}>
                  {isNew ? (
                    <Picker
                      disabled={w.busy || uncertain || !ready || unauthorized}
                      name='projectId'
                      path='procurementAssets'
                      query={{ projectsOnly: 'true' }}
                      value={values.projectId}
                      onChange={(v) => set('projectId', v)}
                      error={shown.projectId}
                    />
                  ) : null}
                  {['name', 'contact', 'phone', 'supplyScope'].map((k) =>
                    field(k, true, k === 'supplyScope'),
                  )}
                  {field('address')}
                  {field('taxNumber')}
                  {field('qualificationUntil', false, false, 'date')}
                  {field('notes', false, true)}
                </Group>
              ) : null}
              {(isNew || mode === 'edit') && kind === 'requests' ? (
                <>
                  <Group title={t('procurement.requests')}>
                    {field('title', true)}
                    {isNew ? (
                      <>
                        <Picker
                          disabled={
                            w.busy || uncertain || !ready || unauthorized
                          }
                          name='assetId'
                          path='procurementAssets'
                          value={values.assetId}
                          caption={str(repair.data?.data.payload.assetName)}
                          onChange={(v) => {
                            set('assetId', v);
                            set('repairId', '');
                          }}
                          error={shown.assetId}
                        />
                        {values.assetId ? (
                          <Picker
                            disabled={
                              w.busy || uncertain || !ready || unauthorized
                            }
                            name='repairId'
                            path='repairOrders'
                            query={{ assetId: values.assetId }}
                            value={values.repairId}
                            onChange={(v) => set('repairId', v)}
                            caption={params.repairId}
                            error={shown.repairId}
                          />
                        ) : null}
                        <Button
                          type='button'
                          variant='ghost'
                          onClick={() => set('repairId', '')}
                        >
                          {t('procurement.noRepair')}
                        </Button>
                      </>
                    ) : null}
                    {field('neededOn', true, false, 'date')}
                    {field('reason', true, true)}
                    {field('notes', false, true)}
                  </Group>
                  <Group title={t('procurement.items')}>
                    {values.items.map((i, n: number) => (
                      <div
                        key={n}
                        className='flex flex-col gap-3 rounded-md border p-4'
                      >
                        <p className='font-medium'>
                          {t('procurement.itemNumber', { number: n + 1 })}
                        </p>
                        <div className='grid gap-3 sm:grid-cols-2'>
                          {[
                            'name',
                            'spec',
                            'unit',
                            'quantity',
                            'unitPrice',
                          ].map((k) => (
                            <TextField
                              key={k}
                              name={'items.' + n + '.' + k}
                              label={t('procurement.fields.' + k)}
                              required={k !== 'spec'}
                              value={String(i[k as keyof DraftItem])}
                              type={k === 'quantity' ? 'number' : 'text'}
                              error={shown['items.' + n + '.' + k]}
                              onChange={(v) =>
                                set(
                                  'items',
                                  values.items.map((old, index: number) =>
                                    index === n
                                      ? {
                                          ...old,
                                          [k]: k === 'quantity' ? Number(v) : v,
                                        }
                                      : old,
                                  ),
                                )
                              }
                            />
                          ))}
                        </div>
                        {values.items.length > 1 ? (
                          <Button
                            type='button'
                            variant='ghost'
                            onClick={() =>
                              set(
                                'items',
                                values.items.filter(
                                  (_, index: number) => index !== n,
                                ),
                              )
                            }
                          >
                            {t('procurement.remove')}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    <Button
                      type='button'
                      variant='outline'
                      disabled={values.items.length >= 20}
                      onClick={() =>
                        set('items', [...values.items, initialItem()])
                      }
                    >
                      {t('procurement.addItem')}
                    </Button>
                  </Group>
                </>
              ) : null}
              {mode === 'edit' && kind === 'orders' ? (
                <Group title={t('procurement.items')}>
                  {values.prices?.map((i, n: number) => (
                    <TextField
                      key={i.itemId}
                      name={'prices.' + n + '.unitPrice'}
                      label={
                        (r?.payload.items as Item[])[n].name +
                        ' · ' +
                        t('procurement.fields.unitPrice')
                      }
                      value={i.unitPrice}
                      required
                      error={shown['prices.' + n + '.unitPrice']}
                      onChange={(v) =>
                        set(
                          'prices',
                          (values.prices ?? []).map((old, index: number) =>
                            index === n ? { ...old, unitPrice: v } : old,
                          ),
                        )
                      }
                    />
                  ))}
                </Group>
              ) : null}
              {(isNew || mode === 'edit') && kind === 'receipts' ? (
                <Group title={t('procurement.receipts')}>
                  {field('day', true, false, 'date')}
                  {values.lines.map((line, n: number) => (
                    <div
                      key={line.itemId}
                      className='grid gap-3 rounded-md border p-4 sm:grid-cols-2'
                    >
                      <p className='sm:col-span-2'>
                        {
                          (
                            (r?.payload.items ?? r?.payload.lines) as
                              | { id?: string; itemId?: string; name: string }[]
                              | undefined
                          )?.find((i) => (i.id ?? i.itemId) === line.itemId)
                            ?.name
                        }
                      </p>
                      {['delivered', 'accepted'].map((k) => (
                        <TextField
                          key={k}
                          name={'lines.' + n + '.' + k}
                          label={t('procurement.fields.' + k)}
                          type='number'
                          value={String(line[k as keyof ReceiptLine])}
                          onChange={(v) =>
                            set(
                              'lines',
                              values.lines.map((old, index: number) =>
                                index === n ? { ...old, [k]: Number(v) } : old,
                              ),
                            )
                          }
                          error={shown['lines.' + n + '.' + k]}
                        />
                      ))}
                    </div>
                  ))}
                  {field('evidence', true, true)}
                  {field('notes', false, true)}
                  <p className='text-sm text-muted-foreground'>
                    {t('procurement.receiptHelp')}
                  </p>
                </Group>
              ) : null}
              {mode === 'convert' ? (
                <Picker
                  disabled={w.busy || uncertain || !ready || unauthorized}
                  name='supplierId'
                  path='purchaseSuppliers'
                  query={{ projectId: r?.projectId ?? '', status: 'active' }}
                  value={values.supplierId}
                  onChange={(v) => set('supplierId', v)}
                  error={shown.supplierId}
                />
              ) : null}
              {mode === 'pay' ? (
                <>
                  <p>
                    {t('procurement.fields.outstandingCents')}：
                    <Money cents={r?.outstandingCents ?? '0'} />
                  </p>
                  {field('amount', true)}
                  {field('day', true, false, 'date')}
                  {field('reference', true)}
                  <Choice
                    value={values.channel}
                    onChange={(v) => set('channel', v)}
                    options={['bank', 'cash', 'other'].map((v) => ({
                      value: v,
                      label: t('procurement.channels.' + v),
                    }))}
                  />
                  {field('evidence', true, true)}
                  <p className='text-sm text-muted-foreground'>
                    {t('procurement.simulated')}
                  </p>
                </>
              ) : null}
              {mode === 'reverse' ? field('day', true, false, 'date') : null}
              {!big ? field('note', mode !== 'pay', true) : null}
            </fieldset>
            {Object.keys(shown).length ? (
              <p role='alert' className='text-destructive'>
                {t('procurement.invalid')}
              </p>
            ) : null}
            {!ready ? (
              <p role='alert'>{t('procurement.errors.PURCHASE_CHANGED')}</p>
            ) : null}
          </form>
        )}
      </>
    );
  const reload = () => {
    pendingRef.current = undefined;
    setUncertain(false);
    setLoaded(false);
    setRequestId(crypto.randomUUID());
    w.setError(undefined);
    w.setErrors({});
    void result.refetch();
  };
  const footer = (
    <>
      <Button
        variant='outline'
        disabled={w.busy}
        onClick={() =>
          void Promise.resolve(leave.guard()).then((ok) => {
            if (ok) void navigate(back);
          })
        }
      >
        {t('procurement.cancel')}
      </Button>
      {w.conflict || (loaded && !ready) ? (
        <Button variant='outline' onClick={reload}>
          {t('procurement.reload')}
        </Button>
      ) : null}
      <Button
        type='submit'
        form='procurement-form'
        disabled={
          !loaded ||
          w.busy ||
          !ready ||
          !!unauthorized ||
          !!r?.blockedActions[mode]
        }
      >
        {w.busy
          ? t('procurement.saving')
          : t('procurement.actions.' + (isNew ? 'create' : mode))}
      </Button>
    </>
  );
  const confirmations = (
    <>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={title}
        label={t('procurement.actions.' + (isNew ? 'create' : mode))}
        busy={w.busy}
        destructive={['reverse', 'cancel', 'suspend'].includes(mode)}
        onConfirm={() => void send()}
      >
        {t('procurement.confirm', {
          record: r?.title || str(values.title) || str(values.name),
        })}{' '}
        {t(
          'procurement.consequences.' +
            ([
              'reverse',
              'pay',
              'accept',
              'cancel',
              'convert',
              'settle',
              'suspend',
            ].includes(mode)
              ? mode
              : 'default'),
        )}
      </Confirm>
      <Confirm
        open={leave.discard}
        onOpenChange={leave.dismiss}
        title={t('procurement.discard')}
        label={t('procurement.discard')}
        busy={false}
        onConfirm={() => leave.accept(() => void navigate(back))}
      >
        {t('procurement.discardHelp')}
      </Confirm>
    </>
  );
  return big ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={back}
          onClick={(e) => {
            e.preventDefault();
            void Promise.resolve(leave.guard()).then((ok) => {
              if (ok) void navigate(back);
            });
          }}
        />
        <PageHeader title={title} description={t('procurement.description')} />
        <div className='flex max-w-3xl flex-col gap-4'>
          {content}
          <div className='flex justify-end gap-2'>{footer}</div>
        </div>
        {confirmations}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <RouteDialog
      title={title}
      closeTo={back}
      beforeClose={leave.guard}
      className={mode === 'pay' ? undefined : 'sm:max-w-md'}
      footer={footer}
    >
      {content}
      {confirmations}
    </RouteDialog>
  );
}
