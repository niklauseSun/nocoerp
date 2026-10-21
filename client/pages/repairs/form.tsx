import { RepairPhotoUpload } from './photos.js';
import type {
  FileRecord,
  FileUploadStatus,
} from '#extensions/nocobase-file-component-ui/index';
import { str, today, useRepairCan, useRepairCache } from './helpers.js';
import { useRef, useState, useEffect } from 'react';
import {
  useParams,
  useResolvedPath,
  useLocation,
  useNavigate,
} from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useNavigationGuard,
  useApiClient,
  useToaster,
  ApiClientError,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useWork } from '../cashier/work.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import {
  Group,
  Choice,
  TextField,
  RepairPicker,
  DateField,
  Confirm,
  LoadingRows,
  BillingError,
  type Order,
} from './common.js';
const permission: Record<string, string> = {
  new: 'report',
  edit: 'report',
  assign: 'dispatch',
  reassign: 'dispatch',
  start: 'process',
  progress: 'process',
  complete: 'process',
  accept: 'accept',
  reject: 'accept',
  close: 'close',
  cancel: 'cancel',
};
export default function RepairForm() {
  const p = useParams(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    mode = path.split('/').at(-1)!,
    can = useRepairCan(permission[mode] || 'read'),
    record = useBusinessQuery<{ data: Order }>(
      'repairOrders/' + p.repairId,
      undefined,
      mode !== 'new' && can.can,
    ),
    [revision, setRevision] = useState(0),
    cache = useQueryClient();
  useEffect(() => {
    if (record.error instanceof ApiClientError && record.error.status === 404)
      void cache.invalidateQueries({ queryKey: ['hyl', 'repairOrders'] });
  }, [record.error, cache]);
  if (!can.can)
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton
            to={{
              pathname: path.slice(0, path.lastIndexOf('/')),
              search: l.search,
            }}
          />
          <p>
            <Denied />
          </p>
        </PageContainer>
      </RouteChildPage>
    );
  if (
    mode !== 'new' &&
    (record.error ||
      !record.data ||
      record.isPlaceholderData ||
      !record.isFetchedAfterMount)
  )
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton
            to={{
              pathname: path.slice(0, path.lastIndexOf('/')),
              search: l.search,
            }}
          />
          {record.error ? (
            <BillingError
              error={record.error}
              retry={() => void record.refetch()}
            />
          ) : (
            <LoadingRows />
          )}
        </PageContainer>
      </RouteChildPage>
    );
  return (
    <FormBody
      key={path + ':' + revision}
      mode={mode}
      row={mode === 'new' ? undefined : record.data?.data}
      reload={async () => {
        await record.refetch();
        setRevision((v) => v + 1);
      }}
    />
  );
}
function Denied() {
  const { t } = useTranslation();
  return <>{t('repair.restricted')}</>;
}
function FormBody({
  mode,
  row,
  reload,
}: {
  mode: string;
  row?: Order;
  reload: () => Promise<void>;
}) {
  useCoverFocus();
  const { t } = useTranslation(),
    l = useLocation(),
    path = useResolvedPath('.').pathname,
    navigate = useNavigate(),
    api = useApiClient(),
    toast = useToaster(),
    update = useRepairCache(),
    w = useWork(),
    [baseline] = useState(() => row),
    [data, setData] = useState<Record<string, string>>(() => ({
      title: baseline?.title ?? '',
      description: str(baseline?.payload.description),
      category: baseline?.category ?? 'plumbing',
      priority: baseline?.priority ?? 'normal',
      assetId: baseline?.assetId ?? '',
      merchantId: baseline?.merchantId ?? '',
      contractId: baseline?.contractId ?? '',
      occurredOn: baseline?.occurredOn ?? today(),
      reporterName: str(baseline?.payload.reporterName),
      reporterPhone: str(baseline?.payload.reporterPhone),
      location: str(baseline?.payload.location),
      evidence: mode === 'complete' ? '' : str(baseline?.payload.evidence),
      note: '',
      assigneeId: '',
      dueOn: baseline?.dueOn || today(),
      cost: baseline ? String(Number(baseline.costCents) / 100) : '0',
    })),
    [photos, setPhotos] = useState<readonly FileRecord[]>(() =>
      mode === 'edit' ? (baseline?.photos?.report ?? []) : [],
    ),
    [uploadStatus, setUploadStatus] = useState<FileUploadStatus>('idle'),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false),
    [confirm, setConfirm] = useState(false),
    [unknown, setUnknown] = useState(false),
    mayCloseRef = useRef(false),
    discardRef = useRef<(v: boolean) => void>(undefined),
    pendingLeaveRef = useRef<string | undefined>(undefined),
    discardOpenRef = useRef(false),
    intentRef = useRef<
      { requestId: string; body: Record<string, unknown> } | undefined
    >(undefined);
  const big = mode === 'new' || mode === 'edit',
    back = { pathname: path.slice(0, path.lastIndexOf('/')), search: l.search },
    guard = () => {
      if (mayCloseRef.current) return true;
      if (w.busy || uploadStatus !== 'idle') return false;
      if (!dirty) return true;
      return new Promise<boolean>((resolve) => {
        discardRef.current = resolve;
        discardOpenRef.current = true;
        setDiscard(true);
      });
    };

  // The app's navigation guard is synchronous. Capture the intended local link/POP,
  // decline navigation, then resume that URL after our asynchronous discard dialog.
  useNavigationGuard(() => {
    if (mayCloseRef.current) return true;
    if (uploadStatus !== 'idle') return false;
    if (!dirty) return true;
    if (w.busy || uploadStatus !== 'idle') return false;
    discardRef.current = undefined;
    discardOpenRef.current = true;
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        link &&
        link.target !== '_blank' &&
        !link.download &&
        new URL(link.href).origin === window.location.origin
      )
        pendingLeaveRef.current = link.href;
    };
    const pop = () => {
      if (!discardOpenRef.current)
        pendingLeaveRef.current = window.location.href;
    };
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', pop);
    return () => {
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (dirty && !mayCloseRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty]);
  const validate = (values: Record<string, string>) => {
    const errors = Object.fromEntries(
      required
        .filter((k) => !values[k]?.trim())
        .map((k) => [k, t('repair.required')]),
    );
    if (mode === 'complete' && !/^\d{1,12}(\.\d{1,2})?$/.test(values.cost))
      errors.cost = t('repair.invalid');
    for (const key of [
      'title',
      'reporterName',
      'reporterPhone',
      'location',
      'description',
      'note',
      'evidence',
    ]) {
      const max =
        key === 'title' || key === 'reporterName'
          ? 100
          : key === 'reporterPhone'
            ? 50
            : key === 'location'
              ? 300
              : key === 'description' || (key === 'note' && mode === 'complete')
                ? 4000
                : 2000;
      if (values[key].length > max) errors[key] = t('repair.invalid');
    }
    return errors;
  };
  const change = (key: string, value: string) => {
    if (unknown || w.busy || uploadStatus !== 'idle') return;
    if (key === 'assetId' && value !== data.assetId) setPhotos([]);
    setDirty(true);
    setData((d) => ({ ...d, [key]: value }));
    if (w.attempted) w.setErrors(validate({ ...data, [key]: value }));
  };
  const required = big
    ? [
        'title',
        'description',
        'category',
        'priority',
        'reporterName',
        'reporterPhone',
        ...(mode === 'new' ? ['assetId', 'occurredOn'] : []),
      ]
    : mode === 'assign' || mode === 'reassign'
      ? ['assigneeId', 'dueOn', 'note']
      : mode === 'complete'
        ? ['note', 'evidence', 'cost']
        : ['note'];
  const send = async () => {
    if (w.busy || uploadStatus !== 'idle') return;
    const errors = validate(data);
    if (!w.focus(errors)) return;
    if (['accept', 'reject', 'close', 'cancel'].includes(mode) && !confirm) {
      setConfirm(true);
      return;
    }
    w.setBusy(true);
    w.setError(undefined);
    try {
      if (!intentRef.current) {
        const values = Object.fromEntries(
          [
            'title',
            'description',
            'category',
            'priority',
            'reporterName',
            'reporterPhone',
            'location',
            'evidence',
            ...(mode === 'new'
              ? ['assetId', 'merchantId', 'contractId', 'occurredOn']
              : []),
          ].map((k) => [k, data[k]]),
        );
        const selectedPhotos = photos.map((file) => file.id);
        let body: Record<string, unknown> = {
          values: { ...values, reportPhotoIds: selectedPhotos },
        };
        if (!big)
          body = Object.fromEntries(
            (mode === 'assign' || mode === 'reassign'
              ? ['assigneeId', 'dueOn', 'note']
              : mode === 'complete'
                ? ['note', 'evidence', 'cost']
                : ['note']
            ).map((k) => [k, data[k]]),
          );
        if (['progress', 'complete', 'accept', 'reject'].includes(mode))
          body.photoIds = selectedPhotos;
        if (mode !== 'new')
          Object.assign(body, {
            action: mode,
            expectedVersion: baseline?.version,
          });
        intentRef.current = { requestId: crypto.randomUUID(), body };
      }
      const intent = intentRef.current,
        result = await api.request<{ data: Order }>({
          path:
            mode === 'new'
              ? 'repairOrders'
              : 'repairOrders/' + baseline?.id + '/actions',
          method: 'POST',
          json: { ...intent.body, requestId: intent.requestId },
        });
      await update(result.data);
      mayCloseRef.current = true;
      setDirty(false);
      w.setBusy(false);
      setConfirm(false);
      toast.show({
        title: t(mode === 'new' ? 'repair.created' : 'repair.success', {
          name: result.data.number,
          action: t('repair.actions.' + mode),
        }),
      });
      void navigate(back);
    } catch (e) {
      w.fail(e);
      if (!(e instanceof ApiClientError) || e.status >= 500) setUnknown(true);
      else {
        intentRef.current = undefined;
        setUnknown(false);
      }
      w.setBusy(false);
    }
  };
  const f = (name: string, multiline = false) => (
    <TextField
      key={name}
      name={name}
      value={data[name]}
      onChange={(v) => change(name, v)}
      required={required.includes(name)}
      error={w.errors[name]}
      multiline={multiline}
    />
  );
  const choice = (name: string, values: string[], group: string) => (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('repair.fields.' + name)} *
      </FieldLabel>
      <Choice
        id={'cashier-' + name}
        value={data[name]}
        onChange={(v) => change(name, v)}
        options={values.map((value) => ({
          value,
          label: t('repair.' + group + '.' + value),
        }))}
      />
      <FieldError>{w.errors[name]}</FieldError>
    </Field>
  );
  const picker = (
    name: string,
    kind: 'assets' | 'contracts' | 'merchants' | 'repairAssignees',
  ) => (
    <RepairPicker
      disabled={w.busy || unknown || w.conflict || uploadStatus !== 'idle'}
      kind={kind}
      name={name}
      value={data[name]}
      onChange={(v) => change(name, v)}
      required={required.includes(name)}
      error={w.errors[name]}
    />
  );
  const date = (name: string) => (
    <Field>
      <FieldLabel htmlFor={'cashier-' + name}>
        {t('repair.fields.' + name)} *
      </FieldLabel>
      <DateField
        id={'cashier-' + name}
        value={data[name]}
        onChange={(v) => change(name, v)}
      />
      <FieldError>{w.errors[name]}</FieldError>
    </Field>
  );
  const title =
    big && mode === 'new'
      ? t('repair.new')
      : t('repair.confirmTitle', {
          action: t('repair.actions.' + mode),
          name: baseline?.number,
        });
  const errors = (
    <>
      {w.error ? <BillingError error={w.error} /> : null}
      {unknown ? (
        <Alert>
          <AlertDescription>{t('repair.unknown')}</AlertDescription>
        </Alert>
      ) : null}
      {w.conflict ? (
        <Button
          variant='outline'
          onClick={() => {
            mayCloseRef.current = true;
            void reload();
          }}
        >
          {t('repair.reload')}
        </Button>
      ) : null}
    </>
  );
  const body = (
    <form
      id='repair-form'
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className='flex flex-col gap-4'
    >
      {errors}
      <fieldset
        disabled={w.busy || unknown || w.conflict || uploadStatus !== 'idle'}
        className='flex min-w-0 flex-col gap-4'
      >
        {big ? (
          <>
            <Group title={t('repair.basic')}>
              {f('title')}
              {f('description', true)}
              {choice(
                'category',
                [
                  'plumbing',
                  'electrical',
                  'airConditioning',
                  'facility',
                  'other',
                ],
                'categories',
              )}
              {choice(
                'priority',
                ['low', 'normal', 'high', 'urgent'],
                'priorities',
              )}
              {f('reporterName')}
              {f('reporterPhone')}
              {f('location')}
              {f('evidence', true)}
            </Group>
            {mode === 'new' ? (
              <Group title={t('repair.sources')}>
                {picker('assetId', 'assets')}
                {picker('merchantId', 'merchants')}
                {picker('contractId', 'contracts')}
                {date('occurredOn')}
                <p className='text-muted-foreground'>
                  {t('repair.identityFrozen')}
                </p>
              </Group>
            ) : (
              <p className='text-muted-foreground'>
                {t('repair.identityFrozen')}
              </p>
            )}
          </>
        ) : (
          <>
            {mode === 'assign' || mode === 'reassign' ? (
              <>
                {picker('assigneeId', 'repairAssignees')}
                {date('dueOn')}
              </>
            ) : null}
            {f('note', true)}
            {mode === 'complete' ? (
              <>
                {f('evidence', true)}
                {f('cost')}
                <p className='text-muted-foreground'>{t('repair.costHelp')}</p>
              </>
            ) : null}
          </>
        )}
      </fieldset>
      {['new', 'edit', 'progress', 'complete', 'accept', 'reject'].includes(
        mode,
      ) ? (
        <RepairPhotoUpload
          key={data.assetId}
          assetId={data.assetId}
          orderId={baseline?.id}
          stage={
            big
              ? 'report'
              : ['accept', 'reject'].includes(mode)
                ? 'acceptance'
                : 'processing'
          }
          value={photos}
          onChange={(next) => {
            setPhotos(next);
            setDirty(true);
            setConfirm(false);
          }}
          onStarted={() => setDirty(true)}
          onStatusChange={setUploadStatus}
          disabled={w.busy || unknown || w.conflict}
        />
      ) : null}
      {uploadStatus !== 'idle' ? (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('repair.photos.pending')}
        </p>
      ) : null}
    </form>
  );
  const footer = (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={w.busy || uploadStatus !== 'idle'}
        onClick={() =>
          void Promise.resolve(guard()).then((ok) => {
            if (ok) void navigate(back);
          })
        }
      >
        {t('repair.cancel')}
      </Button>
      <Button
        type='submit'
        form='repair-form'
        disabled={w.busy || w.conflict || uploadStatus !== 'idle'}
      >
        {t(
          w.busy
            ? 'repair.saving'
            : big
              ? 'repair.save'
              : 'repair.actions.' + mode,
        )}
      </Button>
    </>
  );
  const confirmations = (
    <>
      <Confirm
        open={discard}
        onOpenChange={(open) => {
          if (!open) {
            discardOpenRef.current = false;
            setDiscard(false);
            discardRef.current?.(false);
          }
        }}
        title={t('repair.discardTitle')}
        label={t('repair.discard')}
        destructive
        busy={false}
        onConfirm={() => {
          mayCloseRef.current = true;
          setDirty(false);
          discardOpenRef.current = false;
          setDiscard(false);
          if (discardRef.current) discardRef.current(true);
          else if (pendingLeaveRef.current)
            window.location.assign(pendingLeaveRef.current);
          else void navigate(back);
        }}
      >
        {t('repair.discardHelp')}
      </Confirm>
      {['accept', 'reject', 'close', 'cancel'].includes(mode) ? (
        <Confirm
          open={confirm}
          onOpenChange={setConfirm}
          title={title}
          label={t('repair.actions.' + mode)}
          destructive={['reject', 'cancel'].includes(mode)}
          busy={w.busy}
          onConfirm={() => void send()}
          rich
        >
          <p>{t('repair.consequences.' + mode)}</p>
          {errors}
        </Confirm>
      ) : null}
    </>
  );
  return big ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton
          to={back}
          onClick={(e) => {
            e.preventDefault();
            void Promise.resolve(guard()).then((ok) => {
              if (ok) void navigate(back);
            });
          }}
        />
        <PageHeader title={title} description={t('repair.newDescription')} />
        <div className='flex max-w-3xl flex-col gap-4'>
          {body}
          <div className='flex flex-wrap justify-end gap-2'>{footer}</div>
        </div>
        {confirmations}
      </PageContainer>
    </RouteChildPage>
  ) : (
    <RouteDialog
      title={title}
      closeTo={back}
      beforeClose={guard}
      className={
        mode === 'assign' || mode === 'reassign' ? undefined : 'sm:max-w-md'
      }
      footer={footer}
    >
      {body}
      {confirmations}
    </RouteDialog>
  );
}
