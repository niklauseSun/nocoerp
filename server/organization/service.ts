import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { ApiError } from '@nocobase/app-server/router';
import { activeChain, departmentsOf } from './tree.js';
import {
  departmentInput,
  projectInput,
  type Department,
  type Member,
  type ProjectAccess,
} from './model.js';
import type { z } from 'zod';
export function refuse(
  reason: string,
  status: 'NOT_FOUND' | 'ABORTED' | 'INVALID_ARGUMENT' = 'INVALID_ARGUMENT',
): never {
  throw new ApiError({
    status,
    reason,
    domain: 'organization',
    message: `Organization operation refused: ${reason}.`,
  });
}
export class OrganizationService {
  constructor(
    readonly db: DatabaseManager,
    readonly authz: AppAuthorization,
    readonly users: UserAdministrationService,
  ) {}
  tree(c = this.db.connection()) {
    return c
      .repository<Department>('hylDepartments')
      .findMany({ sort: (s) => [s.field('title').asc(), s.field('id').asc()] });
  }
  async subjects(userId: string, c = this.db.connection()) {
    return departmentsOf(
      await this.tree(c),
      await c
        .repository<Member>('hylDepartmentMembers')
        .findMany({ filter: { userId } }),
    );
  }
  async filterActive(ids: readonly string[], c = this.db.connection()) {
    const tree = await this.tree(c);
    return ids.filter((id) => activeChain(tree, id));
  }
  async projectIds(userId: string, c = this.db.connection()) {
    const subjects = new Set(await this.subjects(userId, c));
    const rows = await c
      .repository<ProjectAccess>('hylProjectAccess')
      .findMany({ filter: { active: true } });
    return [
      ...new Set(
        rows
          .filter((x) =>
            x.subjectType === 'user'
              ? x.subjectId === userId
              : x.subjectType === 'org.department' && subjects.has(x.subjectId),
          )
          .map((x) => x.projectId),
      ),
    ];
  }
  async snapshot() {
    const departments = await this.tree(),
      members = await this.db
        .repository<Member>('hylDepartmentMembers')
        .findMany(),
      projects = await this.db
        .repository<ProjectAccess>('hylProjectAccess')
        .findMany();
    const people = [
        ...new Set([
          ...members.map((x) => x.userId),
          ...projects
            .filter((x) => x.subjectType === 'user')
            .map((x) => x.subjectId),
        ]),
      ],
      names: Record<string, string> = {};
    const memberProfiles: Record<
      string,
      { email: string; disabledAt: string | null }
    > = {};
    for (const id of people) {
      const user = await this.users.get(id);
      if (user) {
        names[id] = user.name;
        memberProfiles[id] = {
          email: user.email,
          disabledAt: user.disabledAt ? String(user.disabledAt) : null,
        };
      }
    }
    for (const row of await this.db
      .repository<{ id: string; name: string; type: string }>('hylAssets')
      .findMany({
        filter: { type: 'project' },
        select: (s) => s.fields('id', 'name'),
      }))
      names[String(row.id)] = String(row.name);
    return { departments, members, projects, names, memberProfiles };
  }

  async user(id: string, c: DatabaseConnection) {
    const u = await this.users.withConnection(c).get(id);
    if (!u || u.disabledAt) refuse('ORG_USER_UNAVAILABLE');
    return u;
  }
  async lock(c: DatabaseConnection) {
    const repo = c.repository('hylOrganizationLock'),
      row = await repo.findOne({ filter: { id: 'organization' } });
    if (!row) refuse('ORG_NOT_FOUND', 'NOT_FOUND');
    const r = await repo.updateMany({
      filter: { id: 'organization', version: Number(row.version) },
      values: { version: Number(row.version) + 1 },
    });
    if (r.updatedCount !== 1) refuse('ORG_STALE', 'ABORTED');
  }
  async audit(
    c: DatabaseConnection,
    actor: string,
    action: string,
    target: string,
    before: unknown,
    after: unknown,
  ) {
    await c.repository('hylOrganizationAudit').createOne({
      values: {
        id: randomUUID(),
        actor,
        action,
        target,
        before: before as Record<string, unknown> | null,
        after: after as Record<string, unknown> | null,
        at: new Date().toISOString(),
      },
    });
  }
  async refresh(c: DatabaseConnection, ids: readonly string[]) {
    for (const id of new Set(ids))
      await this.authz.permissionSets
        .withTransaction(c)
        .notifyAssignmentsChanged({ type: 'user', id });
  }
  async department(
    actor: string,
    input: z.infer<typeof departmentInput>,
    id?: string,
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const tree = await this.tree(c),
        old = id ? tree.find((x) => x.id === id) : undefined;
      if (id && !old) refuse('ORG_NOT_FOUND', 'NOT_FOUND');
      if (old && old.version !== input.version) refuse('ORG_STALE', 'ABORTED');
      if (input.parentId) {
        if (!tree.some((x) => x.id === input.parentId))
          refuse('ORG_PARENT_MISSING');
        let p: string | null = input.parentId;
        const seen = new Set<string>();
        while (p) {
          if (p === id || seen.has(p)) refuse('ORG_CYCLE');
          seen.add(p);
          p = tree.find((x) => x.id === p)?.parentId ?? null;
        }
      }
      const row: Department = {
        ...input,
        id: id ?? randomUUID(),
        version: (old?.version ?? -1) + 1,
      };
      const changed = (
        await c.repository<Member>('hylDepartmentMembers').findMany()
      ).map((x) => x.userId);
      // Protected assignments must remain usable even when their department ancestor is disabled.
      if (old?.active && !row.active) {
        const affected = tree
          .filter((x) => activeChain(tree, x.id)?.includes(row.id))
          .map((x) => x.id);
        const sets = this.authz.permissionSets.withTransaction(c);
        for (const subjectId of affected)
          await sets.assertSubjectRemovable({
            type: 'org.department',
            id: subjectId,
          });
      }
      if (old)
        await c.repository<Department>('hylDepartments').updateOne({
          filter: { id: row.id, version: old.version },
          values: row,
        });
      else
        await c
          .repository<Department>('hylDepartments')
          .createOne({ values: row });
      await this.audit(
        c,
        actor,
        old ? 'department.update' : 'department.create',
        row.id,
        old ?? null,
        row,
      );
      await this.refresh(c, changed);
      return row;
    });
  }
  async member(
    actor: string,
    departmentId: string,
    input: { userId: string; active: boolean; primary: boolean },
  ) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      if (!(await this.tree(c)).some((x) => x.id === departmentId))
        refuse('ORG_NOT_FOUND', 'NOT_FOUND');
      if (input.active) await this.user(input.userId, c);
      const repo = c.repository<Member>('hylDepartmentMembers'),
        old = await repo.findOne({
          filter: { departmentId, userId: input.userId },
        });
      if (input.primary && input.active)
        await repo.updateMany({
          filter: { userId: input.userId },
          values: { primary: false },
        });
      const row: Member = {
        ...input,
        departmentId,
        id: old?.id ?? randomUUID(),
        primary: input.active && input.primary,
      };
      if (old) await repo.updateOne({ filter: { id: old.id }, values: row });
      else await repo.createOne({ values: row });
      await this.audit(c, actor, 'membership.update', row.id, old ?? null, row);
      await this.refresh(c, [input.userId]);
      return row;
    });
  }
  async project(actor: string, input: z.infer<typeof projectInput>) {
    return this.db.transaction(async (c) => {
      await this.lock(c);
      const p = await c.repository('hylAssets').findOne({
        filter: { id: input.projectId, type: 'project', state: 'normal' },
      });
      if (!p) refuse('ORG_PROJECT_UNAVAILABLE');
      if (input.active) {
        if (input.subjectType === 'user') await this.user(input.subjectId, c);
        else if (!(await this.filterActive([input.subjectId], c)).length)
          refuse('ORG_DEPARTMENT_DISABLED');
      }
      const repo = c.repository<ProjectAccess>('hylProjectAccess'),
        filter = {
          projectId: input.projectId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
        old = await repo.findOne({ filter });
      if ((old?.version ?? 0) !== input.version) refuse('ORG_STALE', 'ABORTED');
      const row: ProjectAccess = {
        ...input,
        id: old?.id ?? randomUUID(),
        version: (old?.version ?? 0) + 1,
      };
      if (old)
        await repo.updateOne({
          filter: { id: old.id, version: old.version },
          values: row,
        });
      else await repo.createOne({ values: row });
      await this.audit(c, actor, 'project.update', row.id, old ?? null, row);
      const ids =
        input.subjectType === 'user'
          ? [input.subjectId]
          : (await c.repository<Member>('hylDepartmentMembers').findMany()).map(
              (x) => x.userId,
            );
      await this.refresh(c, ids);
      return row;
    });
  }
}
