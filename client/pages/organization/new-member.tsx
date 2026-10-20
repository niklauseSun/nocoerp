import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Label } from '#components/ui/label';
import { FieldError } from '#components/ui/field';
import { useLeave } from '../inspections/leave.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import {
  Choice,
  Search,
  Paged,
  Confirm,
  ErrorBox,
  Denied,
  LoadingRows,
  OrgEmpty,
  type Options,
  type Snapshot,
} from './common.js';
import type { ReactNode } from 'react';
type Account = Options['users'][number];

function Footer({ busy, valid }: { busy: boolean; valid: boolean }) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('organization.cancel')}
      </Button>
      <Button
        form='organization-new-member'
        type='submit'
        disabled={!valid || busy}
      >
        {t(busy ? 'organization.saving' : 'organization.add')}
      </Button>
    </>
  );
}
function Form({
  children,
  save,
  busy,
}: {
  children: ReactNode;
  save: () => Promise<boolean>;
  busy: boolean;
}) {
  const { close } = useRouteOverlay();
  return (
    <form
      id='organization-new-member'
      className='flex flex-col gap-4'
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void save().then((saved) => {
          if (saved) void close();
        });
      }}
    >
      {children}
    </form>
  );
}
function MemberDialog({ departmentId }: { departmentId: string | null }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const can = useSetting('hyl.organization', 'update');
  const r = useOrg<{ data: Snapshot }>('organization', undefined, can.can);
  const [selected, setSelected] = useState<Account | null>(null);
  const [primary, setPrimary] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const department = r.data?.data.departments.find(
    (d) => d.id === departmentId,
  );
  const options = useOrg<{ data: Options }>(
    'organization/options',
    { q: search, page, pageSize: 20 },
    can.can && !!department,
  );
  const w = useSave();
  const leave = useLeave(!!selected || primary, w.busy);
  const eligible = (account: Account) =>
    !account.disabledAt &&
    !r.data?.data.members.some(
      (m) =>
        m.departmentId === departmentId && m.userId === account.id && m.active,
    );
  const accounts = [
    ...(selected ? [selected] : []),
    ...(options.data?.data.users ?? []),
  ].filter(
    (account, index, all) =>
      eligible(account) && all.findIndex((a) => a.id === account.id) === index,
  );
  const valid =
    can.can &&
    !!department &&
    !!selected &&
    eligible(selected) &&
    !r.error &&
    !r.isFetching;
  const save = async () => {
    setAttempted(true);
    if (!selected)
      document.getElementById('organization-new-member-user')?.focus();
    if (!valid || !selected || !department || w.busy) return false;
    const result = await w.run(
      'organization/departments/' + department.id + '/members',
      'PUT',
      { userId: selected.id, active: true, primary },
      t('organization.memberInDepartment', {
        name: selected.name,
        department: department.title,
      }),
    );
    if (!result) return false;
    leave.allow();
    return true;
  };
  return (
    <>
      <RouteDialog
        title={t('organization.addDepartmentMember')}
        description={
          department
            ? t('organization.addMemberToDepartment', {
                name: department.title,
              })
            : t('organization.addMemberHelp')
        }
        beforeClose={leave.guard}
        footer={<Footer busy={w.busy} valid={!!valid} />}
      >
        {!can.can ? (
          <Denied />
        ) : r.error ? (
          <ErrorBox error={r.error} retry={() => void r.refetch()} />
        ) : !r.data ? (
          <LoadingRows />
        ) : !department ? (
          <OrgEmpty
            title={t('organization.errors.ORG_NOT_FOUND')}
            description={t('organization.memberDepartmentRequired')}
          />
        ) : (
          <Form save={save} busy={w.busy}>
            <ErrorBox error={w.error} />
            <Search
              value={search}
              placeholder={t('organization.searchUsers')}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
            />
            {search ? (
              <Button
                type='button'
                variant='outline'
                className='self-start'
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
              >
                {t('organization.clear')}
              </Button>
            ) : null}
            <ErrorBox
              error={options.error}
              retry={() => void options.refetch()}
            />
            <Label htmlFor='organization-new-member-user'>
              {t('organization.user')} *
            </Label>
            <Choice
              id='organization-new-member-user'
              invalid={attempted && !selected}
              ariaDescribedBy={
                attempted && !selected
                  ? 'member-user-error'
                  : 'member-user-help'
              }
              ariaLabel={t('organization.user')}
              value={selected?.id ?? ''}
              onChange={(id) =>
                setSelected(accounts.find((a) => a.id === id) ?? null)
              }
              disabled={w.busy || options.isFetching || !!options.error}
              options={[
                { value: '', label: t('organization.chooseUser') },
                ...accounts.map((a) => ({
                  value: a.id,
                  label: a.name + ' · ' + a.email,
                })),
              ]}
            />
            {attempted && !selected ? (
              <FieldError id='member-user-error'>
                {t('organization.chooseUser')}
              </FieldError>
            ) : null}
            <p id='member-user-help' className='text-sm text-muted-foreground'>
              {t('organization.selectMemberHelp')}
            </p>
            {options.isFetching ? (
              <LoadingRows />
            ) : !options.error && !accounts.length ? (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('organization.noEligibleMembersOnPage')}
              </p>
            ) : null}
            <Paged
              meta={{
                page,
                pageSize: 20,
                total: options.data?.data.userTotal ?? 0,
              }}
              onChange={setPage}
            />
            <Label>
              <Checkbox
                checked={primary}
                onCheckedChange={(value) => setPrimary(value === true)}
                disabled={w.busy}
              />
              {t('organization.primary')}
            </Label>
          </Form>
        )}
      </RouteDialog>
      <Confirm
        open={leave.discard}
        label={t('organization.discardChanges')}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        busy={w.busy}
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
    </>
  );
}
export default function NewMember() {
  const [params] = useSearchParams();
  const departmentId = params.get('department');
  return (
    <MemberDialog key={departmentId ?? 'missing'} departmentId={departmentId} />
  );
}
