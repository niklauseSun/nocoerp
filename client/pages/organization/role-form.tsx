import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@nocobase/app-client';
import { OrgEmpty } from './common.js';
import { useOrg, useSave, useSetting } from './hooks.js';
import { useState, useEffect } from 'react';
import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type {
  AuthorizationOptionsResponse,
  PermissionGrant,
  PermissionSet,
  PermissionSetAssignment,
} from '@nocobase/app-plugin-authorization/client';
import {
  PermissionEditor,
  type PermissionEditorSection,
} from '#components/permission-editor';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import routes from '../../routes.js';
import { useCoverFocus } from '../profit-sharing/focus.js';
import { useLeave } from '../inspections/leave.js';
import {
  Group,
  Denied,
  ErrorBox,
  LoadingRows,
  Choice,
  Search,
  Paged,
  Confirm,
  type Snapshot,
  type Options,
} from './common.js';
function Form({
  initial,
  options,
  isNew,
}: {
  initial: PermissionSet;
  options: AuthorizationOptionsResponse;
  isNew: boolean;
}) {
  const { t } = useTranslation(),
    l = useLocation(),
    navigate = useNavigate(),
    [q, setQ] = useSearchParams(),
    [key, setKey] = useState(initial.key),
    [name, setName] = useState(() =>
      typeof initial.title === 'string'
        ? initial.title
        : initial.title
          ? t(initial.title.key, { ns: initial.title.ns })
          : initial.key,
    ),
    [grants, setGrants] = useState<readonly PermissionGrant[]>(initial.grants),
    [type, setType] = useState('user'),
    [subject, setSubject] = useState(''),
    [remove, setRemove] = useState<PermissionSetAssignment | null>(null),
    w = useSave(),
    write = useSetting(
      'authorization.permission-sets',
      isNew ? 'create' : 'update',
    ),
    assign = useSetting('authorization.permission-sets', 'assign'),
    revoke = useSetting('authorization.permission-sets', 'assign'),
    page = Number(q.get('rolePage')) || 1,
    search = q.get('roleQ') ?? '',
    o = useOrg<{ data: Options }>('organization/options', {
      q: search,
      page,
      pageSize: 20,
    }),
    org = useOrg<{ data: Snapshot }>('organization'),
    a = useOrg<{ data: PermissionSetAssignment[] }>(
      'authorization/permissionSets/' +
        encodeURIComponent(initial.key) +
        '/assignments',
      undefined,
      !isNew,
    ),
    dirty =
      key !== initial.key ||
      name !==
        (typeof initial.title === 'string'
          ? initial.title
          : initial.title
            ? t(initial.title.key, { ns: initial.title.ns })
            : initial.key) ||
      JSON.stringify(grants) !== JSON.stringify(initial.grants),
    leave = useLeave(dirty, w.busy),
    back = { pathname: '/organization/roles', search: l.search },
    protectedWrite =
      initial.protection &&
      !initial.protection.allow.includes(isNew ? 'create' : 'update'),
    readOnly = !write.can || !!protectedWrite || w.busy;
  const text = (x: string | { key: string; ns?: string }) =>
    typeof x === 'string' ? x : t(x.key, { ns: x.ns });
  const sections: PermissionEditorSection[] = options.sections.flatMap((s) =>
    s.subsections.map((sub) => ({
      id: s.name + ':' + sub.name,
      title: text(s.title) + ' · ' + text(sub.title),
      groups: sub.resources.map((r) => ({
        id: r.type + ':' + r.id,
        title: text(r.title),
        accessOnly: r.type === 'page',
        rows: r.actions.map((action) => {
          const stored = grants
              .find((g) => g.resource.type === r.type && g.resource.id === r.id)
              ?.actions.find((a) => a.action === action.name),
            scopes = (stored?.policy?.scopes ?? {}) as Record<string, unknown>;
          return {
            id: encodeURIComponent(JSON.stringify([r.type, r.id, action.name])),
            label: text(action.title),
            actionKey: action.name,
            enabled: !!stored,
            scopes: (r.dataScopes?.[action.name] ?? []).map((scope) => ({
              id: encodeURIComponent(
                JSON.stringify([r.type, r.id, action.name, scope.key]),
              ),
              label:
                scope.collection === 'hylAssets'
                  ? t('assets.title')
                  : scope.collection === 'hylContracts'
                    ? t('hyl.nav.contracts')
                    : text(scope.title),
              level:
                typeof scopes[scope.key] === 'string'
                  ? String(scopes[scope.key])
                  : scopes[scope.key]
                    ? '__stored__'
                    : '',
              levels: [
                { value: '', label: t('organization.noRecords') },
                ...scope.recordAccess
                  .filter((k) => k !== 'customFilter')
                  .map((value) => ({
                    value,
                    label: text(
                      options.recordAccess.find((x) => x.key === value)
                        ?.title ?? value,
                    ),
                  })),
                ...(scopes[scope.key] && typeof scopes[scope.key] !== 'string'
                  ? [
                      {
                        value: '__stored__',
                        label: t('organization.storedScope'),
                      },
                    ]
                  : []),
              ],
            })),
          };
        }),
      })),
    })),
  );
  // Users is a public record resource, not a project-scoped business collection.
  sections.push({
    id: 'user-management',
    title: t('organization.userManagement'),
    groups: [
      {
        id: 'user:*',
        title: t('organization.users'),
        rows: [
          'read',
          'create',
          'update',
          'disable',
          'enable',
          'assign-role',
          'reset-password',
          'revoke-sessions',
        ].map((action) => ({
          id: encodeURIComponent(JSON.stringify(['user', '*', action])),
          label: t('organization.userActions.' + action),
          enabled: grants.some(
            (g) =>
              g.resource.type === 'user' &&
              g.resource.id === '*' &&
              g.actions.some((a) => a.action === action),
          ),
        })),
      },
    ],
  });
  // Page catalogue is application route metadata; server options intentionally supplies only the page record type.
  const pageRows = routes
    .flatMap((c) => c.routes)
    .flatMap((r) =>
      'authz' in r &&
      r.authz &&
      typeof r.authz === 'object' &&
      r.authz.resource.type === 'page'
        ? [
            {
              id: r.authz.resource.id,
              title: r.navigation?.title ?? r.authz.resource.id,
            },
          ]
        : [],
    );
  sections.unshift({
    id: 'pages',
    title: t('organization.pages'),
    groups: pageRows.map((p) => ({
      id: p.id,
      title: t(p.title),
      accessOnly: true,
      rows: [
        {
          id: encodeURIComponent(JSON.stringify(['page', p.id, 'access'])),
          label: t('organization.access'),
          enabled: grants.some(
            (g) =>
              g.resource.type === 'page' &&
              g.resource.id === p.id &&
              g.actions.some((a) => a.action === 'access'),
          ),
        },
      ],
    })),
  });
  const change = (id: string, enabled?: boolean, level?: string) => {
    const [type, idValue, action, scope] = JSON.parse(
      decodeURIComponent(id),
    ) as string[];
    setGrants((old) => {
      const next = old.map((x) => ({ ...x, actions: [...x.actions] })),
        i = next.findIndex(
          (x) => x.resource.type === type && x.resource.id === idValue,
        ),
        g =
          i < 0
            ? {
                resource: { type, id: idValue },
                actions: [] as PermissionGrant['actions'][number][],
              }
            : next[i],
        a = g.actions.find((x) => x.action === action);
      let updated = g.actions.filter((x) => x.action !== action);
      if (enabled !== false) {
        const original = a?.policy,
          scopes = { ...((original?.scopes ?? {}) as Record<string, unknown>) };
        if (scope && level !== '__stored__') scopes[scope] = level ?? '';
        const resource = options.sections
          .flatMap((s) => s.subsections)
          .flatMap((s) => s.resources)
          .find((r) => r.type === type && r.id === idValue);
        if (!a && resource?.dataScopes?.[action])
          for (const s of resource.dataScopes[action]) scopes[s.key] = '';
        updated = [
          ...updated,
          {
            action,
            ...(scope || resource?.dataScopes?.[action]?.length
              ? { policy: { type: 'composite', scopes } }
              : original
                ? { policy: original }
                : {}),
          },
        ];
      }
      const replacement = { ...g, actions: updated };
      if (i < 0) next.push(replacement);
      else next[i] = replacement;
      return next.filter((x) => x.actions.length);
    });
  };
  const names = new Map([
    ...Object.entries(org.data?.data.names ?? {}),
    ...(o.data?.data.users ?? []).map((u) => [u.id, u.name] as const),
    ...(org.data?.data.departments ?? []).map((d) => [d.id, d.title] as const),
  ]);
  return (
    <>
      <BackButton
        to={back}
        onClick={(event) => {
          event.preventDefault();
          void Promise.resolve(leave.guard()).then((allowed) => {
            if (allowed) void navigate(back, { replace: true });
          });
        }}
      />
      <PageHeader title={isNew ? t('organization.newRole') : name} />
      <Group
        title={t('organization.functionalPermissions')}
        description={t('organization.scopeWarning')}
      >
        <ErrorBox error={w.error} />
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            void w
              .run(
                'authorization/permissionSets' +
                  (isNew ? '' : '/' + encodeURIComponent(initial.key)),
                isNew ? 'POST' : 'PATCH',
                {
                  key,
                  title:
                    name ===
                    (typeof initial.title === 'string'
                      ? initial.title
                      : initial.title
                        ? t(initial.title.key, { ns: initial.title.ns })
                        : initial.key)
                      ? initial.title
                      : name,
                  grants,
                },
                name,
              )
              .then((x) => {
                if (x) {
                  leave.allow();
                  void navigate(back);
                }
              });
          }}
        >
          <Label htmlFor='role-key'>{t('organization.roleKey')} *</Label>
          <Input
            id='role-key'
            required
            pattern='[a-zA-Z0-9_.-]+'
            maxLength={100}
            value={key}
            disabled={!isNew || readOnly}
            onChange={(e) => setKey(e.target.value)}
          />
          <Label htmlFor='role-title'>{t('organization.name')} *</Label>
          <Input
            id='role-title'
            required
            maxLength={100}
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
          <PermissionEditor
            sections={sections.filter((s) => s.groups.length)}
            readOnly={readOnly}
            onEnabledChange={(id, v) => change(id, v)}
            onLevelChange={(id, v) => change(id, true, v)}
            labels={{
              search: t('organization.searchPermissions'),
              enabledOnly: t('organization.enabledOnly'),
              clear: t('organization.clear'),
              empty: t('organization.noPermissions'),
              noResults: t('organization.noResults'),
              navigation: t('organization.permissionCategories'),
              selectAll: t('organization.all'),
              levelFor: (row) => t('organization.levelFor', { name: row }),
              summary: (enabled, total) =>
                t('organization.enabledCount', { enabled, total }),
            }}
          />
          {!readOnly ? (
            <div className='flex justify-end'>
              <Button type='submit' disabled={w.busy}>
                {t(w.busy ? 'organization.saving' : 'organization.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </Group>
      {!isNew ? (
        <Group
          title={t('organization.assignments')}
          description={t('organization.roleAssignmentHint')}
        >
          <ErrorBox error={a.error} retry={() => void a.refetch()} />
          {!a.data && !a.error ? <LoadingRows /> : null}
          {a.data?.data.map((x) => (
            <div
              key={x.id}
              className='flex flex-wrap items-center justify-between gap-2'
            >
              <span className='break-all text-sm'>
                {names.get(x.subject.id) ?? x.subject.id} ·{' '}
                {x.subject.type === 'user'
                  ? t('organization.direct')
                  : t('organization.inherited')}
              </span>
              {revoke.can &&
              (!initial.protection ||
                initial.protection.allow.includes('revoke')) ? (
                <Button
                  variant='ghost'
                  disabled={w.busy}
                  onClick={() => setRemove(x)}
                >
                  {t('organization.revoke')}
                </Button>
              ) : null}
            </div>
          ))}
          {!a.data?.data.length ? (
            <OrgEmpty
              title={t('organization.noAssignments')}
              description={t('organization.emptyAssignmentsHelp')}
            />
          ) : null}
          {assign.can &&
          (!initial.protection ||
            initial.protection.allow.includes('assign')) ? (
            <>
              <Search
                value={search}
                placeholder={t('organization.searchUsers')}
                onChange={(v) => {
                  const n = new URLSearchParams(q);
                  n.set('roleQ', v);
                  n.delete('rolePage');
                  setQ(n, { replace: true });
                }}
              />
              <Choice
                value={type}
                onChange={(v) => {
                  setType(v);
                  setSubject('');
                }}
                ariaLabel={t('organization.subjectType')}
                options={[
                  { value: 'user', label: t('organization.user') },
                  ...(initial.protection?.assignableTo &&
                  !initial.protection.assignableTo.includes('org.department')
                    ? []
                    : [
                        {
                          value: 'org.department',
                          label: t('organization.department'),
                        },
                      ]),
                ]}
                disabled={w.busy}
              />
              <Choice
                value={subject}
                onChange={setSubject}
                ariaLabel={t('organization.subject')}
                options={[
                  { value: '', label: t('organization.chooseSubject') },
                  ...(type === 'user'
                    ? (o.data?.data.users ?? [])
                        .filter((x) => !x.disabledAt)
                        .map((x) => ({
                          value: x.id,
                          label: x.name + ' · ' + x.email,
                        }))
                    : (org.data?.data.departments ?? [])
                        .filter((x) => x.active)
                        .map((x) => ({ value: x.id, label: x.title }))),
                ]}
                disabled={w.busy}
              />
              <Paged
                meta={{
                  page,
                  pageSize: 20,
                  total: o.data?.data.userTotal ?? 0,
                }}
                onChange={(p) => {
                  const n = new URLSearchParams(q);
                  n.set('rolePage', String(p));
                  setQ(n);
                }}
              />
              <div className='flex justify-end'>
                <Button
                  disabled={
                    !subject ||
                    w.busy ||
                    a.data?.data.some(
                      (x) =>
                        x.subject.type === type && x.subject.id === subject,
                    )
                  }
                  onClick={() =>
                    void w.run(
                      'authorization/permissionSets/' +
                        encodeURIComponent(initial.key) +
                        '/assignments',
                      'POST',
                      { subject: { type, id: subject } },
                      names.get(subject) ?? subject,
                    )
                  }
                >
                  {t(w.busy ? 'organization.saving' : 'organization.grant')}
                </Button>
              </div>
            </>
          ) : null}
        </Group>
      ) : null}
      <Confirm
        open={!!remove}
        label={t('organization.revoke')}
        error={w.error}
        title={t('organization.revokeNamed', {
          name: remove
            ? (names.get(remove.subject.id) ?? remove.subject.id)
            : '',
        })}
        description={t('organization.revokeHint')}
        busy={w.busy}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove)
            void w
              .run(
                'authorization/permissionSets/' +
                  encodeURIComponent(initial.key) +
                  '/assignments/' +
                  remove.id,
                'DELETE',
                undefined,
                names.get(remove.subject.id) ?? remove.subject.id,
              )
              .then((result) => {
                if (result) setRemove(null);
              });
        }}
      />
      <Confirm
        open={leave.discard}
        label={t('organization.discardChanges')}
        title={t('organization.discard')}
        description={t('organization.discardHint')}
        busy={w.busy}
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
export default function RoleForm() {
  const cache = useQueryClient(),
    location = useLocation();
  useCoverFocus();
  const p = useParams(),
    isNew = p.roleKey === 'new',
    can = useSetting('authorization.permission-sets'),
    r = useOrg<{ data: PermissionSet }>(
      'authorization/permissionSets/' + encodeURIComponent(p.roleKey ?? ''),
      undefined,
      can.can && !isNew,
    ),
    o = useOrg<{ data: AuthorizationOptionsResponse }>(
      'authorization/permissionSets/options',
      undefined,
      can.can,
    );
  useEffect(() => {
    if (r.error instanceof ApiClientError && r.error.status === 404)
      void cache.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'organization' &&
          q.queryKey[3] === 'authorization/permissionSets',
      });
  }, [cache, r.error]);
  return (
    <RouteChildPage>
      <PageContainer>
        {!can.can || r.error || o.error || !o.data || (!isNew && !r.data) ? (
          <BackButton
            to={{ pathname: '/organization/roles', search: location.search }}
          />
        ) : null}
        {!can.can ? (
          <Denied />
        ) : r.error || o.error ? (
          <ErrorBox
            error={r.error ?? o.error}
            retry={() => {
              void r.refetch();
              void o.refetch();
            }}
          />
        ) : !o.data || (!isNew && !r.data) ? (
          <LoadingRows />
        ) : (
          <Form
            key={p.roleKey}
            initial={isNew ? { key: '', title: '', grants: [] } : r.data!.data}
            options={o.data.data}
            isNew={isNew}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
