import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Button } from '#components/ui/button';
import { FieldError } from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import { useLeave } from '../inspections/leave.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import {
  Denied,
  ErrorBox,
  LoadingRows,
  Choice,
  Confirm,
  type Snapshot,
} from './common.js';
function Footer({ busy, allowed }: { busy: boolean; allowed: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('organization.cancel')}
      </Button>
      <Button
        form='org-new-department'
        type='submit'
        disabled={busy || !allowed}
      >
        {busy ? <Spinner /> : null}
        {t('organization.create')}
      </Button>
    </>
  );
}
function Body({
  title,
  setTitle,
  parent,
  setParent,
  w,
  done,
}: {
  title: string;
  setTitle: (v: string) => void;
  parent: string;
  setParent: (v: string) => void;
  w: ReturnType<typeof useSave>;
  done: () => void;
}) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay(),
    can = useSetting('hyl.organization', 'update'),
    r = useOrg<{ data: Snapshot }>('organization'),
    [attempted, setAttempted] = useState(false),
    [parentError, setParentError] = useState(''),
    inputRef = useRef<HTMLInputElement>(null),
    nameError =
      attempted && !title.trim() ? t('organization.nameRequired') : '';
  if (!can.can) return <Denied />;
  if (r.error)
    return <ErrorBox error={r.error} retry={() => void r.refetch()} />;
  if (!r.data) return <LoadingRows />;
  return (
    <form
      id='org-new-department'
      noValidate
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        setParentError('');
        if (!title.trim()) {
          inputRef.current?.focus();
          return;
        }
        void w
          .run(
            'organization/departments',
            'POST',
            {
              title: title.trim(),
              parentId: parent || null,
              active: true,
              version: 0,
            },
            title,
            (error) => {
              if (
                error instanceof ApiClientError &&
                ['ORG_CYCLE', 'ORG_PARENT_MISSING'].includes(error.reason ?? '')
              ) {
                setParentError(t('organization.errors.' + error.reason));
                requestAnimationFrame(() =>
                  document.getElementById('org-new-parent')?.focus(),
                );
              }
            },
          )
          .then((result) => {
            if (result) {
              done();
              void close();
            }
          });
      }}
    >
      <ErrorBox error={w.error} />
      <div className='flex flex-col gap-2'>
        <Label htmlFor='org-new-title'>{t('organization.name')} *</Label>
        <Input
          ref={inputRef}
          autoFocus
          required
          maxLength={100}
          id='org-new-title'
          value={title}
          disabled={w.busy}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'org-new-name-error' : undefined}
          onChange={(e) => setTitle(e.target.value)}
        />
        {nameError ? (
          <FieldError id='org-new-name-error'>{nameError}</FieldError>
        ) : null}
      </div>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='org-new-parent'>{t('organization.parent')}</Label>
        <Choice
          id='org-new-parent'
          invalid={!!parentError}
          ariaDescribedBy={parentError ? 'org-new-parent-error' : undefined}
          value={parent}
          onChange={(v) => {
            setParent(v);
            setParentError('');
          }}
          ariaLabel={t('organization.parent')}
          disabled={w.busy}
          options={[
            { value: '', label: t('organization.noParent') },
            ...r.data.data.departments.map((x) => ({
              value: x.id,
              label: x.title,
            })),
          ]}
        />
        {parentError ? (
          <FieldError id='org-new-parent-error'>{parentError}</FieldError>
        ) : null}
      </div>
    </form>
  );
}
export default function NewDepartment() {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    location = useLocation(),
    back = { pathname: '/organization/departments', search: location.search },
    [title, setTitle] = useState(''),
    [parent, setParent] = useState(''),
    w = useSave(),
    leave = useLeave(!!title || !!parent, w.busy),
    can = useSetting('hyl.organization', 'update');
  return (
    <>
      <RouteDialog
        title={t('organization.newDepartment')}
        description={t('organization.departmentHint')}
        beforeClose={leave.guard}
        footer={<Footer busy={w.busy} allowed={can.can} />}
      >
        {' '}
        <Body
          title={title}
          setTitle={setTitle}
          parent={parent}
          setParent={setParent}
          w={w}
          done={leave.allow}
        />
      </RouteDialog>
      <Confirm
        open={leave.discard}
        label={t('organization.discardChanges')}
        busy={w.busy}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        onCancel={leave.dismiss}
        onConfirm={() =>
          leave.accept(() => {
            void navigate(back);
          })
        }
      />
    </>
  );
}
