import { followupBack, matchFollowupSearch } from './return-path.js';
import { useRef, useState } from 'react';
import { useLocation, useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useWork } from '../cashier/work.js';
import { useLeave } from '../inspections/leave.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import {
  BillingError,
  DateField,
  Choice,
  LoadingRows,
  Money,
  Day,
} from '../billing/common.js';
import { RecordedAt } from '../cashier/common.js';
import {
  followupSchema,
  importSchema,
  matchSchema,
  type Followup,
  type BankRow,
  type Match,
} from '../../../server/tenant-operations/model.js';
import { parseBankCsv, bankSample } from './csv.js';
interface Detail {
  source: { name: string; date: string; amountCents: string };
  items: Followup[];
  canWrite: boolean;
}
interface Matching {
  row: BankRow;
  match?: Match;
  candidates: { id: string }[];
  events: {
    id: string;
    number: string;
    reference: string;
    date: string;
    amountCents: string;
  }[];
  differences: {
    id: string;
    reference: string;
    date: string;
    method: string;
    amountCents: string;
    differenceCents: string;
  }[];
  canWrite: boolean;
}
export default function Action() {
  const location = useLocation();
  return <OperationAction key={location.pathname} />;
}
function OperationAction() {
  const { t } = useTranslation(),
    l = useLocation(),
    params = useParams(),
    api = useApiClient(),
    cache = useQueryClient(),
    toast = useToaster(),
    navigate = useNavigate(),
    w = useWork(),
    isImport = l.pathname.endsWith('/import'),
    isMatch = !!params.bankRowId,
    back = followupBack(params.kind, params.sourceId, l.search);
  const [requestId] = useState(() => crypto.randomUUID());
  const [note, setNote] = useState(''),
    [nextDate, setNextDate] = useState(''),
    [account, setAccount] = useState(''),
    [rows, setRows] = useState<ReturnType<typeof parseBankCsv>>([]),
    [event, setEvent] = useState(''),
    [fileError, setFileError] = useState(false),
    [attempted, setAttempted] = useState(false),
    fileRef = useRef<HTMLInputElement>(null),
    noteRef = useRef<HTMLTextAreaElement>(null);
  const r = useBusinessQuery<{ data: Detail }>(
      `tenantOperations/followups/${params.kind}/${params.sourceId}`,
      undefined,
      !isImport && !isMatch,
    ),
    m = useBusinessQuery<{ data: Matching }>(
      `tenantOperations/reconciliation/${params.bankRowId}`,
      undefined,
      isMatch,
    ),
    grant = useCan({
      resource: { type: 'settings', id: 'hyl.externalReconciliation' },
      action: 'write',
    });
  const dirty = !!(note || nextDate || account || rows.length || event),
    leave = useLeave(dirty, w.busy),
    canWrite = isImport
      ? grant.can
      : isMatch
        ? m.data?.data.canWrite
        : r.data?.data.canWrite;
  const valid = isImport
      ? !!(account && rows.length && !fileError)
      : isMatch
        ? !!(event && note)
        : !!(note && nextDate),
    close = () => {
      leave.allow();
      void navigate(back);
    };
  const save = async () => {
    setAttempted(true);
    if (!valid) {
      if (isImport) fileRef.current?.focus();
      else noteRef.current?.focus();
      return;
    }
    w.setError(undefined);
    w.setBusy(true);
    try {
      const path = isImport
        ? 'tenantOperations/reconciliation/import'
        : isMatch
          ? 'tenantOperations/reconciliation/confirm'
          : 'tenantOperations/followups';
      const body = isImport
        ? importSchema.parse({ requestId: requestId, account, rows })
        : isMatch
          ? matchSchema.parse({
              requestId: requestId,
              rowId: params.bankRowId,
              eventId: event,
              reason: note,
            })
          : followupSchema.parse({
              requestId: requestId,
              kind: params.kind,
              sourceId: params.sourceId,
              note,
              nextDate,
            });
      await api.request({ path, method: 'POST', json: body });
      leave.allow();
      await cache.invalidateQueries({ queryKey: ['hyl'] });
      toast.show({ title: t('operations.saved'), type: 'success' });
      w.setBusy(false);
      close();
    } catch (e) {
      w.fail(e);
      w.setBusy(false);
    }
  };
  const current = isMatch ? m : r,
    loading = !isImport && current.isPending,
    error = !isImport && current.error;
  return (
    <>
      <RouteDialog
        title={t(
          isImport
            ? 'operations.importTitle'
            : isMatch
              ? 'operations.matchTitle'
              : 'operations.followupTitle',
        )}
        closeTo={back}
        beforeClose={leave.guard}
        footer={
          <>
            <Button
              variant='outline'
              disabled={w.busy}
              onClick={() => {
                void (async () => {
                  if (await leave.guard()) close();
                })();
              }}
            >
              {t('operations.cancel')}
            </Button>
            {canWrite ? (
              <Button
                type='submit'
                form='tenant-operation-form'
                disabled={
                  w.busy || loading || (isMatch && !m.data?.data.events.length)
                }
              >
                {w.busy
                  ? t('hyl.copy.saving')
                  : t(isMatch ? 'operations.confirm' : 'operations.save')}
              </Button>
            ) : null}
          </>
        }
      >
        {loading ? (
          <LoadingRows />
        ) : error ? (
          <BillingError error={error} retry={() => void current.refetch()} />
        ) : (
          <form
            id='tenant-operation-form'
            noValidate
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {!canWrite ? (
              <p className='text-sm text-muted-foreground'>
                {t('billing.restricted')}
              </p>
            ) : null}
            {isImport ? (
              <>
                <p className='text-sm text-muted-foreground'>
                  {t('operations.bankHelp')}
                </p>
                <Button
                  variant='outline'
                  type='button'
                  onClick={() => {
                    const url = URL.createObjectURL(
                        new Blob([bankSample], {
                          type: 'text/csv;charset=utf-8',
                        }),
                      ),
                      a = document.createElement('a');
                    a.href = url;
                    a.download = 'TEST-bank-example.csv';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {t('operations.sample')}
                </Button>
                <Field>
                  <FieldLabel htmlFor='ops-account'>
                    {t('operations.account')}
                  </FieldLabel>
                  <Input
                    id='ops-account'
                    value={account}
                    maxLength={100}
                    disabled={w.busy || !canWrite}
                    onChange={(e) => setAccount(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='ops-file'>
                    {t('operations.file')}
                  </FieldLabel>
                  <Input
                    ref={fileRef}
                    id='ops-file'
                    type='file'
                    accept='.csv,text/csv'
                    disabled={w.busy || !canWrite}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      void (async () => {
                        w.setBusy(true);
                        setFileError(false);
                        setRows([]);
                        if (file) {
                          try {
                            if (file.size > 2_000_000) throw Error();
                            setRows(parseBankCsv(await file.text()));
                          } catch {
                            setFileError(true);
                          }
                        }
                        w.setBusy(false);
                      })();
                    }}
                  />
                  {fileError ? (
                    <FieldError>{t('operations.badCsv')}</FieldError>
                  ) : null}
                </Field>
                {rows.length ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {t('operations.preview')} ·{' '}
                        {t('operations.rows', { count: rows.length })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {rows.slice(0, 5).map((row) => (
                        <p key={row.externalId} className='break-all text-sm'>
                          {row.externalId} · {row.date} · {row.reference} ·{' '}
                          <Money cents={row.amountCents} />
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </>
            ) : isMatch ? (
              m.data ? (
                <>
                  <p className='break-all'>
                    {m.data.data.row.externalId} ·{' '}
                    <Day value={m.data.data.row.date} /> ·{' '}
                    {m.data.data.row.reference} ·{' '}
                    <Money cents={m.data.data.row.amountCents} />
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {t('operations.matchHelp')}
                  </p>
                  <Button
                    variant='outline'
                    type='button'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: `/tenantOperations/followup/bank/${params.bankRowId}`,
                          search: matchFollowupSearch(
                            params.bankRowId!,
                            l.search,
                          ),
                        }}
                      />
                    }
                  >
                    {t('operations.followup')}
                  </Button>
                  {m.data.data.differences?.length ? (
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('operations.differences')}</CardTitle>
                      </CardHeader>
                      <CardContent className='flex flex-col gap-2'>
                        {m.data.data.differences.slice(0, 5).map((d) => (
                          <p key={d.id} className='break-all text-sm'>
                            {d.reference} · <Day value={d.date} /> ·{' '}
                            {t('operations.methods.' + d.method)} ·{' '}
                            <Money cents={d.amountCents} /> ·{' '}
                            {t('operations.differenceAmount')}{' '}
                            <Money cents={d.differenceCents} />
                          </p>
                        ))}
                        {m.data.data.differences.length > 5 ? (
                          <p className='text-sm text-muted-foreground'>
                            {t('operations.differenceLimit')}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}
                  {m.data.data.match ? (
                    <p>
                      {t('operations.statuses.matched')} ·{' '}
                      {m.data.data.match.reason}
                    </p>
                  ) : m.data.data.events.length ? (
                    <Field>
                      <FieldLabel>{t('operations.event')}</FieldLabel>
                      <Choice
                        value={event}
                        onChange={setEvent}
                        disabled={w.busy || !canWrite}
                        ariaLabel={t('operations.event')}
                        options={m.data.data.events.map((e) => ({
                          value: e.id,
                          label: `${e.number} · ${e.date} · ${e.reference}${m.data.data.candidates.some((c) => c.id === e.id) ? ' ✓' : ''}`,
                        }))}
                      />
                    </Field>
                  ) : (
                    <p>{t('operations.noCandidates')}</p>
                  )}
                </>
              ) : null
            ) : r.data ? (
              <>
                <p>
                  {r.data.data.source.name} ·{' '}
                  <Day value={r.data.data.source.date} />
                </p>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('operations.history')}</CardTitle>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-3'>
                    {r.data.data.items.length ? (
                      r.data.data.items.map((f) => (
                        <article key={f.id} className='flex flex-col gap-1'>
                          <p className='text-sm text-muted-foreground'>
                            <RecordedAt value={f.createdAt} /> ·{' '}
                            <Day value={f.nextDate} />
                          </p>
                          <p className='whitespace-pre-wrap break-words'>
                            {f.note}
                          </p>
                        </article>
                      ))
                    ) : (
                      <p>{t('operations.empty')}</p>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
            {canWrite && !isImport ? (
              <>
                <Field>
                  <FieldLabel htmlFor='ops-note'>
                    {t(isMatch ? 'operations.reason' : 'operations.note')}
                  </FieldLabel>
                  <Textarea
                    ref={noteRef}
                    id='ops-note'
                    value={note}
                    maxLength={1000}
                    disabled={w.busy}
                    onChange={(e) => setNote(e.target.value)}
                    aria-invalid={attempted && !note}
                  />
                </Field>
                {!isMatch ? (
                  <Field>
                    <FieldLabel htmlFor='ops-next'>
                      {t('operations.nextDate')}
                    </FieldLabel>
                    <DateField
                      id='ops-next'
                      value={nextDate}
                      onChange={setNextDate}
                      disabled={w.busy}
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
            {attempted && !valid ? (
              <FieldError>{t('operations.required')}</FieldError>
            ) : null}
            {w.error ? <BillingError error={w.error} /> : null}
          </form>
        )}
      </RouteDialog>
      <DiscardDialog
        open={leave.discard}
        onOpenChange={(v) => {
          if (!v) leave.dismiss();
        }}
        onConfirm={() => leave.accept(close)}
      />
    </>
  );
}
