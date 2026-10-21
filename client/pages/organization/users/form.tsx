import { ApiClientError } from '@nocobase/app-client';
import { UserError } from './user-error.js';
import { useEffect, useState, type ReactNode } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  isEmailAddress,
  type ManagedUser,
  type UsersOptions,
  type UserRoleValue,
} from '@nocobase/app-plugin-users/client/user-client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { FieldError } from '#components/ui/field';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { useLeave } from '../../inspections/leave.js';
import { useOrg } from '../hooks.js';
import { Choice, Confirm, Denied, LoadingRows, OrgEmpty } from '../common.js';
import {
  useUserAction,
  useUserPermission,
  userQuery,
  type UserPage,
  restoreUserFocus,
} from './hooks.js';
type Mode = 'create' | 'edit' | 'password';
type Fields = {
  name: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
};
function Footer({
  busy,
  allowed,
  label,
}: {
  busy: boolean;
  allowed: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('organization.cancel')}
      </Button>
      {allowed ? (
        <Button type='submit' form='staff-account-form' disabled={busy}>
          {t(busy ? 'organization.saving' : label)}
        </Button>
      ) : null}
    </>
  );
}
function Form({
  children,
  submit,
  busy,
}: {
  children: ReactNode;
  submit: () => Promise<boolean>;
  busy: boolean;
}) {
  const { close } = useRouteOverlay();
  return (
    <form
      id='staff-account-form'
      noValidate
      aria-busy={busy}
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        e.preventDefault();
        void submit().then((ok) => {
          if (ok) void close();
        });
      }}
    >
      {children}
    </form>
  );
}
function AccountDialog({
  mode,
  userId,
}: {
  mode: Mode;
  userId: string | undefined;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const read = useUserPermission('read');
  const create = useUserPermission('create');
  const assign = useUserPermission('assign-role');
  const update = useUserPermission('update', userId);
  const reset = useUserPermission('reset-password', userId);
  const allowed =
    read.can &&
    (mode === 'create'
      ? create.can && assign.can
      : mode === 'edit'
        ? update.can
        : reset.can);
  const users = useOrg<UserPage>(
    'users',
    userQuery(params),
    allowed && mode !== 'create',
    'always',
  );
  const options = useOrg<{ data: UsersOptions }>(
    'users/options',
    undefined,
    allowed && mode === 'create',
    'always',
  );
  const [baseline, setBaseline] = useState<ManagedUser | null>(null);
  const [fields, setFields] = useState<Fields>({
    name: '',
    username: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [roles, setRoles] = useState<Record<string, UserRoleValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [missing, setMissing] = useState(false);
  const w = useUserAction();
  const target = users.data?.data.find((user) => user.id === userId);
  const fresh =
    mode === 'create'
      ? options.isSuccess && options.isFetchedAfterMount
      : users.isSuccess && users.isFetchedAfterMount;
  if (!initialized && fresh) {
    setInitialized(true);
    if (target) {
      setBaseline(target);
      setFields({
        name: target.name,
        username: target.username ?? '',
        email: target.email,
        password: '',
        confirm: '',
      });
    }
  }
  const dirty =
    mode === 'create'
      ? Object.values(fields).some(Boolean) ||
        Object.values(roles).some((v) =>
          typeof v === 'string' ? !!v : v.length > 0,
        )
      : mode === 'password'
        ? !!fields.password || !!fields.confirm
        : !!baseline &&
          (fields.name !== baseline.name ||
            fields.email !== baseline.email ||
            fields.username !== (baseline.username ?? ''));
  const leave = useLeave(allowed && dirty, w.busy);
  useEffect(() => () => restoreUserFocus(userId), [userId]);
  const scopes = options.data?.data.roleScopes ?? [];
  const problem = mode === 'create' ? options.error : users.error;
  const exists = !missing && (mode === 'create' || !!target);
  const ready =
    allowed &&
    initialized &&
    (mode === 'create' || !!baseline) &&
    exists &&
    !problem;
  const submit = async () => {
    if (!ready || w.busy) return false;
    const next: Record<string, string> = {};
    if (mode !== 'password') {
      if (!fields.name.trim()) next.name = t('organization.staffNameRequired');
      if (!isEmailAddress(fields.email.trim()))
        next.email = t('organization.staffEmailInvalid');
    }
    if (mode !== 'edit') {
      if (!fields.password)
        next.password = t('organization.staffPasswordRequired');
      if (fields.confirm !== fields.password || !fields.confirm)
        next.confirm = t('organization.staffPasswordMismatch');
    }
    if (mode === 'create')
      for (const scope of scopes) {
        const value = roles[scope.key];
        if (
          scope.requiredOnCreate &&
          (!value || (typeof value !== 'string' && !value.length))
        )
          next['role-' + scope.key] = t('organization.staffRoleRequired', {
            name:
              scope.key === 'app'
                ? t('organization.roles')
                : scope.labelI18nKey
                  ? t(scope.labelI18nKey, { ns: scope.labelI18nNs })
                  : scope.label,
          });
      }
    if (mode === 'create')
      for (const scope of scopes) {
        const value = roles[scope.key];
        const values = typeof value === 'string' ? [value] : (value ?? []);
        const available = new Set(
          scope.options
            .filter((option) => option.assignable !== false)
            .map((option) => option.value),
        );
        if (values.some((value) => !available.has(value)))
          next['role-' + scope.key] = t('organization.staffRoleChanged');
      }
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById('staff-' + Object.keys(next)[0])?.focus();
      return false;
    }
    const roleScopes = Object.fromEntries(
      scopes.flatMap((scope) => {
        const value = roles[scope.key];
        if (!value || (typeof value !== 'string' && !value.length)) return [];
        const allowedOptions = new Set(
          scope.options
            .filter((o) => o.assignable !== false)
            .map((o) => o.value),
        );
        const values = typeof value === 'string' ? [value] : [...value];
        if (!values.every((v) => allowedOptions.has(v))) return [];
        return [[scope.key, scope.selection === 'single' ? values[0] : values]];
      }),
    );
    const ok = await w.run(
      () =>
        mode === 'create'
          ? w.client.create({
              name: fields.name.trim(),
              email: fields.email.trim(),
              ...(fields.username.trim()
                ? { username: fields.username.trim() }
                : {}),
              password: fields.password,
              roleScopes,
            })
          : mode === 'edit'
            ? w.client.update(userId!, {
                name: fields.name.trim(),
                email: fields.email.trim(),
                username: fields.username.trim() || null,
              })
            : w.client.resetPassword(userId!, fields.password),
      mode === 'create'
        ? 'organization.employeeCreated'
        : mode === 'edit'
          ? 'organization.employeeUpdated'
          : 'organization.employeePasswordReset',
      mode === 'create' ? fields.name.trim() : baseline!.name,
      (error) => {
        if (!(error instanceof ApiClientError)) return;
        if (error.status === 404 && mode !== 'create') setMissing(true);
        const field = ['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG'].includes(
          error.reason ?? '',
        )
          ? 'password'
          : error.reason === 'USER_EMAIL_CONFLICT'
            ? 'email'
            : null;
        if (field) {
          setErrors((old) => ({
            ...old,
            [field]: t('organization.staffErrors.' + error.reason),
          }));
          requestAnimationFrame(() =>
            document.getElementById('staff-' + field)?.focus(),
          );
        }
      },
    );
    if (ok) {
      leave.allow();
      setFields((value) => ({ ...value, password: '', confirm: '' }));
    }
    return ok;
  };
  const title =
    mode === 'create'
      ? 'organization.newEmployee'
      : mode === 'edit'
        ? 'organization.editEmployee'
        : 'organization.resetEmployeePassword';
  const label =
    mode === 'create'
      ? 'organization.create'
      : mode === 'edit'
        ? 'organization.save'
        : 'organization.resetPassword';
  const field = (key: keyof Fields, label: string, type = 'text') => (
    <div className='flex flex-col gap-2' key={key}>
      <Label htmlFor={'staff-' + key}>
        {t(label)}
        {key !== 'username' ? ' *' : ''}
      </Label>
      <Input
        id={'staff-' + key}
        type={type}
        value={fields[key]}
        autoComplete={
          type === 'password'
            ? 'new-password'
            : key === 'email'
              ? 'email'
              : key === 'username'
                ? 'username'
                : 'name'
        }
        disabled={w.busy}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? 'staff-error-' + key : undefined}
        onChange={(e) => {
          const value = e.target.value;
          setFields((old) => ({ ...old, [key]: value }));
          setErrors((old) => ({ ...old, [key]: '' }));
        }}
        maxLength={type === 'password' ? undefined : 200}
      />
      {errors[key] ? (
        <FieldError id={'staff-error-' + key}>{errors[key]}</FieldError>
      ) : null}
    </div>
  );
  return (
    <>
      <RouteDialog
        title={t(title)}
        className={mode === 'create' ? 'sm:max-w-2xl' : 'sm:max-w-md'}
        description={
          baseline
            ? t(
                mode === 'password'
                  ? 'organization.resetEmployeePasswordHint'
                  : 'organization.editEmployeeNamed',
                { name: baseline.name, email: baseline.email },
              )
            : t('organization.createEmployeeHint')
        }
        beforeClose={leave.guard}
        footer={<Footer busy={w.busy} allowed={ready} label={label} />}
      >
        {!allowed ? (
          <Denied />
        ) : !initialized ? (
          problem ? (
            <UserError
              error={problem}
              retry={() => {
                void (mode === 'create' ? options.refetch() : users.refetch());
              }}
            />
          ) : (
            <LoadingRows />
          )
        ) : mode !== 'create' && !baseline ? (
          <OrgEmpty
            title={t('organization.staffMissingTitle')}
            description={t('organization.staffMissingHint')}
          />
        ) : (
          <Form submit={submit} busy={w.busy}>
            <UserError
              error={
                w.error instanceof ApiClientError &&
                [
                  'PASSWORD_TOO_SHORT',
                  'PASSWORD_TOO_LONG',
                  'USER_EMAIL_CONFLICT',
                ].includes(w.error.reason ?? '')
                  ? undefined
                  : w.error
              }
            />
            <UserError
              error={problem}
              retry={() => {
                void (mode === 'create' ? options.refetch() : users.refetch());
              }}
            />
            {!exists ? (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('organization.staffMissingHint')}
              </p>
            ) : null}
            {mode !== 'password' ? (
              <>
                {field('name', 'organization.employeeName')}
                {field('username', 'organization.username')}
                {field('email', 'organization.email', 'email')}
              </>
            ) : null}
            {mode !== 'edit' ? (
              <>
                {field(
                  'password',
                  mode === 'create'
                    ? 'organization.initialPassword'
                    : 'organization.newPassword',
                  'password',
                )}
                {field('confirm', 'organization.confirmPassword', 'password')}
              </>
            ) : null}
            {mode === 'create' ? (
              <>
                <p className='text-sm text-muted-foreground'>
                  {t('organization.staffRolesHint')}
                </p>
                {scopes.map((scope) => {
                  const options = scope.options.filter(
                    (option) => option.assignable !== false,
                  );
                  const label =
                    scope.key === 'app'
                      ? t('organization.roles')
                      : scope.labelI18nKey
                        ? t(scope.labelI18nKey, { ns: scope.labelI18nNs })
                        : scope.label;
                  const value = roles[scope.key];
                  const values =
                    typeof value === 'string' ? [value] : (value ?? []);
                  return (
                    <div className='flex flex-col gap-2' key={scope.key}>
                      <Label htmlFor={'staff-role-' + scope.key}>
                        {label}
                        {scope.requiredOnCreate ? ' *' : ''}
                      </Label>
                      {scope.selection === 'single' ? (
                        <Choice
                          id={'staff-role-' + scope.key}
                          ariaLabel={label}
                          value={typeof value === 'string' ? value : ''}
                          onChange={(value) =>
                            setRoles((old) => ({ ...old, [scope.key]: value }))
                          }
                          disabled={w.busy}
                          invalid={!!errors['role-' + scope.key]}
                          options={[
                            {
                              value: '',
                              label: t('organization.chooseStaffRole'),
                            },
                            ...options.map((option) => ({
                              value: option.value,
                              label: option.labelI18nKey
                                ? t(option.labelI18nKey, {
                                    ns: option.labelI18nNs,
                                  })
                                : option.label,
                            })),
                          ]}
                        />
                      ) : (
                        <div
                          id={'staff-role-' + scope.key}
                          role='group'
                          tabIndex={-1}
                          aria-label={label}
                          className='flex max-h-48 flex-col gap-2 overflow-y-auto rounded-lg border p-3'
                        >
                          {options.map((option) => (
                            <Label key={option.value}>
                              <Checkbox
                                disabled={w.busy}
                                checked={values.includes(option.value)}
                                onCheckedChange={(checked) =>
                                  setRoles((old) => ({
                                    ...old,
                                    [scope.key]:
                                      checked === true
                                        ? [...values, option.value]
                                        : values.filter(
                                            (value) => value !== option.value,
                                          ),
                                  }))
                                }
                              />
                              {option.labelI18nKey
                                ? t(option.labelI18nKey, {
                                    ns: option.labelI18nNs,
                                  })
                                : option.label}
                            </Label>
                          ))}
                        </div>
                      )}
                      {!options.length ? (
                        <p className='text-sm text-muted-foreground'>
                          {t('organization.noAssignableStaffRoles')}
                        </p>
                      ) : null}
                      {errors['role-' + scope.key] ? (
                        <FieldError>{errors['role-' + scope.key]}</FieldError>
                      ) : null}
                    </div>
                  );
                })}
              </>
            ) : null}
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
              pathname: '/organization/users',
              search: location.search,
            });
          })
        }
      />
    </>
  );
}
export function StaffDialog({ mode }: { mode: Mode }) {
  const { userId } = useParams();
  return (
    <AccountDialog
      key={mode + ':' + (userId ?? 'new')}
      mode={mode}
      userId={userId}
    />
  );
}
