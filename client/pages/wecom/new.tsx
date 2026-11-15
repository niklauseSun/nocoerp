import { useWrite, useWecom, useAction } from './hooks.js';
import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Spinner } from '#components/ui/spinner';
import { FieldError } from '#components/ui/field';
import { useLeave } from '../inspections/leave.js';
import { ErrorBox, Choice, Confirm, Search, Paged } from './common.js';
function Footer({ busy, allowed }: { busy: boolean; allowed: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('organization.cancel')}
      </Button>
      <Button type='submit' form='wecom-new' disabled={busy || !allowed}>
        {busy ? <Spinner /> : null}
        {t('organization.create')}
      </Button>
    </>
  );
}
export default function NewMapping() {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    l = useLocation(),
    write = useWrite(),
    a = useAction();
  const [kind, setKind] = useState('department'),
    [localId, setLocalId] = useState(''),
    [remoteId, setRemoteId] = useState(''),
    [invalid, setInvalid] = useState(false),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    remoteRef = useRef<HTMLInputElement>(null);
  const options = useWecom<{
    data: {
      users: { id: string; name: string }[];
      userTotal: number;
      departments: { id: string; name: string }[];
    };
  }>('wecom/options', { q: search, page });
  const leave = useLeave(!!localId || !!remoteId, a.busy);
  return (
    <>
      <RouteDialog
        title={t('wecom.new')}
        description={t('wecom.mappingHelp')}
        beforeClose={leave.guard}
        footer={<Footer busy={a.busy} allowed={write} />}
      >
        <form
          id='wecom-new'
          noValidate
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            setInvalid(!localId && !remoteId.trim());
            if (!localId && !remoteId.trim()) {
              remoteRef.current?.focus();
              return;
            }
            void a
              .run('wecom/mappings', {
                kind,
                localId,
                remoteId: remoteId.trim(),
              })
              .then((result) => {
                if (result) {
                  leave.allow();
                  void navigate({ pathname: '/wecom', search: l.search });
                }
              });
          }}
        >
          <ErrorBox error={a.error} />
          <ErrorBox
            error={options.error}
            retry={() => void options.refetch()}
          />
          {!write ? <p>{t('organization.denied')}</p> : null}
          <fieldset disabled={a.busy || !write} className='flex flex-col gap-4'>
            <Label htmlFor='wecom-kind'>{t('wecom.kind')} *</Label>
            <Choice
              id='wecom-kind'
              value={kind}
              onChange={(v) => {
                setKind(v);
                setLocalId('');
                setRemoteId('');
              }}
              options={['department', 'user'].map((value) => ({
                value,
                label: t('wecom.' + value),
              }))}
            />
            <Label htmlFor='wecom-local'>{t('wecom.local')}</Label>
            {kind === 'user' ? (
              <Search
                value={search}
                placeholder={t('wecom.userSearch')}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                  setLocalId('');
                }}
              />
            ) : null}
            <Choice
              id='wecom-local'
              value={localId}
              onChange={(v) => {
                setLocalId(v);
                if (v) setInvalid(false);
              }}
              options={[
                { value: '', label: t('wecom.createLocal') },
                ...((kind === 'user'
                  ? options.data?.data.users
                  : options.data?.data.departments || []
                )?.map((u) => ({
                  value: u.id,
                  label: u.name + ' (' + u.id + ')',
                })) || []),
              ]}
            />
            {kind === 'user' && options.data ? (
              <Paged
                meta={{
                  page,
                  pageSize: 50,
                  total: options.data.data.userTotal,
                }}
                busy={options.isFetching}
                onChange={(v) => {
                  setPage(v);
                  setLocalId('');
                }}
              />
            ) : null}
            <Label htmlFor='wecom-remote'>{t('wecom.remote')}</Label>
            <Input
              id='wecom-remote'
              ref={remoteRef}
              maxLength={64}
              value={remoteId}
              onChange={(e) => {
                setRemoteId(e.target.value);
                if (e.target.value.trim()) setInvalid(false);
              }}
              aria-invalid={invalid}
              aria-describedby='wecom-id-error'
            />
            {invalid ? (
              <FieldError id='wecom-id-error'>
                {t('wecom.requiredId')}
              </FieldError>
            ) : null}
            <p className='text-sm text-muted-foreground'>{t('wecom.idHelp')}</p>
          </fieldset>
        </form>
      </RouteDialog>
      <Confirm
        open={leave.discard}
        busy={a.busy}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        label={t('organization.discardChanges')}
        onCancel={leave.dismiss}
        onConfirm={() =>
          leave.accept(
            () => void navigate({ pathname: '/wecom', search: l.search }),
          )
        }
      />
    </>
  );
}
