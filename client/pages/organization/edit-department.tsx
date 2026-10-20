import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { FieldError } from '#components/ui/field';
import { StatusBadge } from '#components/status-badge';
import { useLeave } from '../inspections/leave.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import {
  Choice,
  Confirm,
  Denied,
  ErrorBox,
  LoadingRows,
  OrgEmpty,
  type Department,
  type Snapshot,
} from './common.js';

function Footer({
  busy,
  allowed = false,
}: {
  busy: boolean;
  allowed?: boolean;
}) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('organization.cancel')}
      </Button>
      {allowed ? (
        <Button
          form='organization-edit-department'
          type='submit'
          disabled={busy}
        >
          {t(busy ? 'organization.saving' : 'organization.save')}
        </Button>
      ) : null}
    </>
  );
}
function Form({
  title,
  parent,
  baseline,
  tree,
  busy,
  w,
  setTitle,
  setParent,
  done,
}: {
  title: string;
  parent: string;
  baseline: Department;
  tree: Department[];
  busy: boolean;
  w: ReturnType<typeof useSave>;
  setTitle: (value: string) => void;
  setParent: (value: string) => void;
  done: () => void;
}) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  const inputRef = useRef<HTMLInputElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [parentError, setParentError] = useState('');
  const excluded = new Set([baseline.id]);
  // Exclude descendants as well as self. The server remains authoritative for concurrent tree edits.
  const queue = [baseline.id];
  for (let index = 0; index < queue.length; index++)
    for (const row of tree)
      if (row.parentId === queue[index] && !excluded.has(row.id)) {
        excluded.add(row.id);
        queue.push(row.id);
      }
  return (
    <form
      id='organization-edit-department'
      noValidate
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setAttempted(true);
        setParentError('');
        if (!title.trim()) {
          inputRef.current?.focus();
          return;
        }
        void w
          .run(
            'organization/departments/' + baseline.id,
            'PATCH',
            {
              title: title.trim(),
              parentId: parent || null,
              active: baseline.active,
              version: baseline.version,
            },
            title.trim(),
            (error) => {
              if (
                error instanceof ApiClientError &&
                ['ORG_CYCLE', 'ORG_PARENT_MISSING'].includes(error.reason ?? '')
              ) {
                setParentError(t('organization.errors.' + error.reason));
                requestAnimationFrame(() =>
                  document.getElementById('org-parent')?.focus(),
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
      <div className='flex flex-col gap-2'>
        <Label htmlFor='org-title'>{t('organization.name')} *</Label>
        <Input
          autoFocus
          ref={inputRef}
          id='org-title'
          value={title}
          maxLength={100}
          required
          disabled={busy}
          aria-invalid={attempted && !title.trim()}
          aria-describedby={
            attempted && !title.trim() ? 'org-name-error' : undefined
          }
          onChange={(e) => setTitle(e.target.value)}
        />
        {attempted && !title.trim() ? (
          <FieldError id='org-name-error'>
            {t('organization.nameRequired')}
          </FieldError>
        ) : null}
      </div>
      <div className='flex flex-col gap-2'>
        <Label htmlFor='org-parent'>{t('organization.parent')}</Label>
        <Choice
          id='org-parent'
          ariaLabel={t('organization.parent')}
          invalid={!!parentError}
          ariaDescribedBy={parentError ? 'org-parent-error' : undefined}
          value={parent}
          onChange={(value) => {
            setParent(value);
            setParentError('');
          }}
          disabled={busy}
          options={[
            { value: '', label: t('organization.noParent') },
            ...tree
              .filter((row) => !excluded.has(row.id))
              .map((row) => ({ value: row.id, label: row.title })),
          ]}
        />
        {parentError ? (
          <FieldError id='org-parent-error'>{parentError}</FieldError>
        ) : null}
      </div>
    </form>
  );
}
function Toggle({
  baseline,
  w,
  done,
  onSuccess,
}: {
  baseline: Department;
  w: ReturnType<typeof useSave>;
  done: () => void;
  onSuccess: () => void;
}) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <Confirm
      open
      label={t(
        baseline.active ? 'organization.disable' : 'organization.enable',
      )}
      title={t(
        baseline.active
          ? 'organization.disableNamed'
          : 'organization.enableNamed',
        { name: baseline.title },
      )}
      description={t(
        baseline.active
          ? 'organization.disableHint'
          : 'organization.enableHint',
      )}
      busy={w.busy}
      error={w.error}
      onCancel={done}
      onConfirm={() => {
        void w
          .run(
            'organization/departments/' + baseline.id,
            'PATCH',
            {
              title: baseline.title,
              parentId: baseline.parentId,
              active: !baseline.active,
              version: baseline.version,
            },
            baseline.title,
          )
          .then((result) => {
            if (result) {
              onSuccess();
              void close();
            }
          });
      }}
    />
  );
}
function Editor({
  department,
  tree,
  reload,
  loadError,
  allowed,
  loading,
  retry,
}: {
  department: Department | undefined;
  tree: Department[];
  reload: () => Promise<boolean>;
  loadError: unknown;
  allowed: boolean;
  loading: boolean;
  retry: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // Background invalidation must not replace an in-progress draft or advance its concurrency version.
  const [baseline, setBaseline] = useState<Department | null>(
    department ?? null,
  );
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (document.querySelector('[data-slot="route-overlay-content"]'))
          return;
        const trigger = document.getElementById(
          'department-menu-' + baseline?.id,
        );
        const fallback = document
          .getElementById('department-tree-search')
          ?.querySelector('input');
        (trigger ?? fallback)?.focus();
      });
    },
    [baseline?.id],
  );
  const [title, setTitle] = useState(baseline?.title ?? '');
  const [parent, setParent] = useState(baseline?.parentId ?? '');
  const [toggle, setToggle] = useState(false);
  const [reset, setReset] = useState(false);
  const [reloading, setReloading] = useState(false);
  const w = useSave();
  const busy = w.busy || reloading;
  const dirty =
    !!baseline &&
    allowed &&
    (title !== baseline.title || parent !== (baseline.parentId ?? ''));
  const leave = useLeave(dirty, busy);
  if (!baseline && department) {
    setBaseline(department);
    setTitle(department.title);
    setParent(department.parentId ?? '');
  }
  if (!allowed || !baseline)
    return (
      <>
        <RouteDialog
          title={t('organization.editDepartment')}
          description={t('organization.departmentHint')}
          footer={<Footer busy={false} />}
        >
          {!allowed ? (
            <Denied />
          ) : loadError ? (
            <ErrorBox error={loadError} retry={retry} />
          ) : loading ? (
            <LoadingRows />
          ) : (
            <OrgEmpty
              title={t('organization.errors.ORG_NOT_FOUND')}
              description={t('organization.editDepartmentMissing')}
            />
          )}
        </RouteDialog>
      </>
    );

  return (
    <>
      <RouteDialog
        title={t('organization.editDepartment')}
        description={t('organization.departmentHint')}
        beforeClose={leave.guard}
        footer={<Footer busy={busy} allowed={!!department} />}
      >
        <ErrorBox error={w.error} />
        <ErrorBox error={loadError} />
        {!department ? (
          <OrgEmpty
            title={t('organization.errors.ORG_NOT_FOUND')}
            description={t('organization.editDepartmentMissing')}
          />
        ) : null}
        {(w.error instanceof ApiClientError &&
          w.error.reason === 'ORG_STALE') ||
        loadError ? (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => setReset(true)}
          >
            {t('organization.reload')}
          </Button>
        ) : null}
        <Form
          title={title}
          parent={parent}
          baseline={baseline}
          tree={tree}
          busy={busy || !department}
          w={w}
          setTitle={setTitle}
          setParent={setParent}
          done={leave.allow}
        />
        <div className='mt-4 flex flex-wrap items-center justify-between gap-2'>
          <StatusBadge tone={baseline.active ? 'success' : 'neutral'}>
            {t(
              baseline.active ? 'organization.active' : 'organization.inactive',
            )}
          </StatusBadge>
          <Button
            variant='outline'
            disabled={busy || dirty || !department}
            onClick={() => setToggle(true)}
          >
            {t(
              baseline.active ? 'organization.disable' : 'organization.enable',
            )}
          </Button>
        </div>
        {dirty ? (
          <p className='mt-2 text-sm text-muted-foreground'>
            {t('organization.saveBeforeDepartmentStatus')}
          </p>
        ) : null}
        {toggle ? (
          <Toggle
            baseline={baseline}
            w={w}
            onSuccess={leave.allow}
            done={() => {
              setToggle(false);
            }}
          />
        ) : null}
      </RouteDialog>
      <Confirm
        open={leave.discard}
        label={t('organization.discardChanges')}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        busy={busy}
        onCancel={leave.dismiss}
        onConfirm={() =>
          leave.accept(() => {
            void navigate({
              pathname: '/organization/departments',
              search: location.search,
            });
          })
        }
      />
      <Confirm
        open={reset}
        label={t('organization.reload')}
        title={t('organization.reload')}
        description={t('organization.reloadHint')}
        busy={busy}
        error={loadError}
        onCancel={() => setReset(false)}
        onConfirm={() => {
          setReloading(true);
          void reload()
            .then((ok) => {
              if (ok) leave.allow();
            })
            .finally(() => setReloading(false));
        }}
      />
    </>
  );
}
function EditDepartmentLoader({
  departmentId,
}: {
  departmentId: string | undefined;
}) {
  const can = useSetting('hyl.organization', 'update');
  const r = useOrg<{ data: Snapshot }>(
    'organization',
    undefined,
    can.can,
    'always',
  );
  const [ready, setReady] = useState(false);
  if (!ready && r.isSuccess && r.isFetchedAfterMount) setReady(true);
  const [revision, setRevision] = useState(0);
  const department = r.data?.data.departments.find(
    (row) => row.id === departmentId,
  );
  return (
    <Editor
      key={departmentId + ':' + revision}
      department={ready ? department : undefined}
      allowed={can.can}
      loading={!ready || !r.data}
      tree={r.data?.data.departments ?? []}
      loadError={r.error}
      retry={() => void r.refetch()}
      reload={async () => {
        const result = await r.refetch();
        if (result.isError) return false;
        setRevision((value) => value + 1);
        return true;
      }}
    />
  );
}

export default function EditDepartment() {
  const { departmentId } = useParams();
  return (
    <EditDepartmentLoader
      key={departmentId ?? 'missing'}
      departmentId={departmentId}
    />
  );
}
