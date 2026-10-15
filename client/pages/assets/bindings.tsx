import { Spinner } from '#components/ui/spinner';
import { bindingDrafts } from './drafts.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { useAssetPermission, useAssetTree, useDraftWarning } from './hooks.js';
import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel } from '#components/ui/field';
import { Card, CardHeader, CardContent, CardTitle } from '#components/ui/card';
import { Choice, DateField, LoadingRows } from '../hyl/common.js';
import { useBusinessPermission } from '../hyl/hooks.js';
import { AssetError } from './shared.js';
import { DiscardDialog } from '../hyl/discard-dialog.js';
import type { Binding, ContractAsset } from './model.js';
function useBindings(id: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['hyl', 'asset-bindings', id],
    queryFn: () =>
      api.request<{ data: Binding[] }>({ path: `merchants/${id}/assets` }),
    enabled: !!id,
    retry: false,
  });
}
export function MerchantAssetBindings({ id }: { id: string }) {
  const result = useBindings(id),
    { t } = useTranslation(),
    can = useAssetPermission('write'),
    merchant = useBusinessPermission('merchants', 'write'),
    location = useLocation();
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <CardTitle>{t('assets.bindings')}</CardTitle>
        {can.can && merchant.can ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link to={{ pathname: 'assets/new', search: location.search }} />
            }
          >
            {t('assets.bind')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {result.isPending ? (
          <LoadingRows />
        ) : result.error ? (
          <AssetError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : result.data?.data.length ? (
          result.data.data.map((b) => (
            <div
              key={b.id}
              className='flex flex-wrap justify-between gap-3 border-b pb-3'
            >
              <div>
                <p>
                  {b.asset?.name ?? b.assetId} · {b.asset?.number}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {result.data?.data
                    .filter((period) => period.assetId === b.assetId)
                    .map((period) => `${period.start} — ${period.end || '—'}`)
                    .join(' / ')}{' '}
                  · {b.area} {t('assets.sqm')}
                </p>
              </div>
              {can.can && merchant.can ? (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: `assets/${b.id}/close`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t('assets.closeBinding')}
                </Button>
              ) : null}
            </div>
          ))
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('assets.noBindings')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
export function ContractAssetsSelector({
  merchantId,
  value,
  onChange,
  disabled,
}: {
  merchantId: string;
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const result = useBindings(merchantId),
    { t } = useTranslation();
  return (
    <Field>
      <FieldLabel>{t('assets.contractAssets')}</FieldLabel>
      <p className='text-sm text-muted-foreground'>
        {t('assets.contractHelp')}
      </p>
      {!merchantId ? (
        <p>{t('assets.chooseMerchantFirst')}</p>
      ) : result.isPending ? (
        <LoadingRows />
      ) : result.error ? (
        <AssetError error={result.error} retry={() => void result.refetch()} />
      ) : result.data?.data.length ? (
        Array.from(
          new Map(result.data.data.map((b) => [b.assetId, b])).values(),
        ).map((b) => (
          <label
            className='flex items-start gap-3 rounded-lg border p-3'
            key={b.assetId}
          >
            <Checkbox
              checked={value.includes(b.assetId)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...value, b.assetId]
                    : value.filter((id) => id !== b.assetId),
                )
              }
            />
            <span>
              {b.asset?.name ?? b.assetId} · {b.asset?.number}
              <span className='block text-sm text-muted-foreground'>
                {result.data?.data
                  .filter((period) => period.assetId === b.assetId)
                  .map((period) => `${period.start} — ${period.end || '—'}`)
                  .join(' / ')}
              </span>
            </span>
          </label>
        ))
      ) : (
        <p>
          {t('assets.noBindings')} {t('assets.bindingGuide')}
        </p>
      )}
    </Field>
  );
}
export function ContractAssetSnapshots({ id }: { id: string }) {
  const api = useApiClient(),
    { t } = useTranslation(),
    result = useQuery({
      queryKey: ['hyl', 'contract-assets', id],
      queryFn: () =>
        api.request<{ data: ContractAsset[] }>({
          path: `contracts/${id}/assets`,
        }),
      retry: false,
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('assets.snapshot')}</CardTitle>
      </CardHeader>
      <CardContent>
        {result.isPending ? (
          <LoadingRows />
        ) : result.error ? (
          <AssetError
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : result.data?.data.length ? (
          result.data.data.map((row) => (
            <div key={row.id} className='mb-3 rounded-lg border p-3'>
              <p>
                {row.snapshot.name} · {row.snapshot.number}
              </p>
              <p className='text-sm text-muted-foreground'>
                {row.snapshot.address} {row.snapshot.floor}{' '}
                {row.snapshot.location} · {row.snapshot.lettableArea}{' '}
                {t('assets.sqm')} · {row.start} — {row.end}
              </p>
            </div>
          ))
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('assets.noContractAssets')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
export default function BindingForm() {
  const { id = '', bindingId } = useParams(),
    api = useApiClient(),
    client = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation(),
    { t } = useTranslation(),
    can = useAssetPermission('write'),
    merchant = useBusinessPermission('merchants', 'write');
  const { session } = useAuthentication(),
    toaster = useToaster();
  const draftKey = `${session?.user.id}/${id}/${bindingId ?? 'new'}`;
  const [restored] = useState(() => bindingDrafts.get(draftKey));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const tree = useAssetTree(can.can && !bindingId),
    bindings = useBindings(id),
    [assetId, setAssetId] = useState(restored?.assetId ?? ''),
    [start, setStart] = useState(restored?.start ?? ''),
    [end, setEnd] = useState(restored?.end ?? ''),
    [area, setArea] = useState(restored?.area ?? '0'),
    [reason, setReason] = useState(restored?.reason ?? ''),
    [requestId] = useState(() => restored?.requestId ?? crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false);
  const current = bindings.data?.data.find((b) => b.id === bindingId),
    dirty = !!(assetId || start || end || reason);
  useEffect(() => {
    if (dirty)
      bindingDrafts.set(draftKey, {
        assetId,
        start,
        end,
        area,
        reason,
        requestId,
      });
  }, [dirty, draftKey, assetId, start, end, area, reason, requestId]);
  useEffect(() => {
    if (!busy) {
      const field = Object.keys(issues).find((key) => !!issues[key]);
      if (field) document.getElementById(`bind-${field}`)?.focus();
    }
  }, [busy, issues]);
  useDraftWarning(dirty || busy);
  const close = () =>
    void navigate(
      { pathname: bindingId ? '../../..' : '../..', search: location.search },
      { relative: 'path', replace: true },
    );
  const save = async () => {
    setConfirm(false);
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: bindingId
          ? `merchants/${id}/assets/${bindingId}/close`
          : `merchants/${id}/assets`,
        method: 'POST',
        json: bindingId
          ? { end, reason, expectedVersion: current?.version }
          : { requestId, assetId, start, end, area },
      });
      await client.invalidateQueries({ queryKey: ['hyl'] });
      bindingDrafts.delete(draftKey);
      toaster.show({
        title: t(bindingId ? 'assets.ended' : 'assets.newBindingSaved', {
          name:
            current?.asset?.name ??
            tree.rows.find((a) => a.id === assetId)?.name ??
            '',
        }),
        type: 'success',
      });
      close();
    } catch (cause) {
      setError(cause);
      if (cause instanceof ApiClientError && cause.reason === 'ASSET_AREA')
        setIssues({ area: t('assets.errors.ASSET_AREA') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <RouteDialog
        title={t(bindingId ? 'assets.closeBinding' : 'assets.bind')}
        beforeClose={() => {
          if (busy) return false;
          if (dirty) {
            setDiscard(true);
            return false;
          }
          return true;
        }}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => (dirty ? setDiscard(true) : close())}
            >
              {t('hyl.actions.back')}
            </Button>
            <Button
              type='submit'
              form='binding-form'
              disabled={
                busy ||
                !can.can ||
                !merchant.can ||
                (bindingId
                  ? !current || !end || !reason.trim()
                  : !assetId || !start)
              }
            >
              {busy ? <Spinner /> : null}
              {t('hyl.actions.save')}
            </Button>
          </>
        }
      >
        <form
          id='binding-form'
          onSubmit={(e) => {
            e.preventDefault();
            const next: Record<string, string> = {};
            if (!bindingId && !/^\d{1,10}(\.\d{1,2})?$/.test(area))
              next.area = t('hyl.errors.invalidField');
            if (!bindingId && end && end < start)
              next.end = t('hyl.errors.INVALID_PERIOD');
            if (
              bindingId &&
              current &&
              (end < current.start || (current.end && end > current.end))
            )
              next.end = t('hyl.errors.INVALID_PERIOD');
            setIssues(next);
            if (Object.keys(next).length) {
              document.getElementById(`bind-${Object.keys(next)[0]}`)?.focus();
              return;
            }
            if (bindingId) setConfirm(true);
            else void save();
          }}
          className='flex flex-col gap-5'
        >
          <p className='text-sm text-muted-foreground'>
            {t(bindingId ? 'assets.closeHelp' : 'assets.bindingHelp')}
          </p>
          {error ? <AssetError error={error} /> : null}
          {bindings.isPending ? (
            <LoadingRows />
          ) : bindings.error ? (
            <AssetError
              error={bindings.error}
              retry={() => void bindings.refetch()}
            />
          ) : bindingId && !current ? (
            <p>{t('hyl.errors.404')}</p>
          ) : null}
          {!bindingId ? (
            <p className='text-sm text-muted-foreground'>
              {t('assets.sharedArea')}
            </p>
          ) : null}
          {bindingId ? (
            <p>
              {current?.asset?.name} · {current?.start} — {current?.end || '—'}
            </p>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor='bind-asset'>
                  {t('assets.choose')} *
                </FieldLabel>
                <Choice
                  id='bind-asset'
                  value={assetId}
                  onChange={setAssetId}
                  disabled={busy}
                  options={tree.rows
                    .filter((a) => a.type === 'unit' || a.type === 'stall')
                    .map((a) => ({
                      value: a.id,
                      label: `${a.name} · ${a.number}`,
                    }))}
                />
              </Field>
              {tree.error ? (
                <AssetError
                  error={tree.error}
                  retry={() => void tree.refetch()}
                />
              ) : null}
              {tree.hasNextPage ? (
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => void tree.fetchNextPage()}
                >
                  {t('assets.more')}
                </Button>
              ) : null}
              <Field>
                <FieldLabel htmlFor='bind-start'>
                  {t('assets.fields.start')} *
                </FieldLabel>
                <DateField
                  id='bind-start'
                  value={start}
                  onChange={setStart}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='bind-area'>
                  {t('assets.fields.bindingArea')} *
                </FieldLabel>
                <Input
                  id='bind-area'
                  required
                  inputMode='decimal'
                  value={area}
                  onChange={(e) => {
                    setArea(e.target.value);
                    setIssues((old) => ({ ...old, area: '' }));
                  }}
                  disabled={busy}
                />
                {issues.area ? (
                  <p className='text-sm text-destructive'>{issues.area}</p>
                ) : null}
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor='bind-end'>
              {t('assets.fields.end')}
              {bindingId ? ' *' : ''}
            </FieldLabel>
            <DateField
              id='bind-end'
              value={end}
              onChange={(v) => {
                setEnd(v);
                setIssues((old) => ({ ...old, end: '' }));
              }}
              disabled={busy}
            />
            {issues.end ? (
              <p className='text-sm text-destructive'>{issues.end}</p>
            ) : null}
          </Field>
          {bindingId ? (
            <Field>
              <FieldLabel htmlFor='bind-reason'>
                {t('assets.fields.reason')} *
              </FieldLabel>
              <Textarea
                id='bind-reason'
                required
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
            </Field>
          ) : null}
        </form>
      </RouteDialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('assets.closeConfirm', { name: current?.asset?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('assets.closeConfirmHelp', { end })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('hyl.actions.back')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void save()}
            >
              {t('assets.closeBinding')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DiscardDialog
        open={discard}
        onOpenChange={setDiscard}
        onConfirm={() => {
          bindingDrafts.delete(draftKey);
          close();
        }}
      />
    </>
  );
}
