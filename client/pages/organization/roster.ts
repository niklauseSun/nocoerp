import type { Department, Member } from './common.js';

/** Use only departments and memberships already present in the authorized snapshot. */
export function departmentScope(
  departments: readonly Department[],
  departmentId: string,
  directOnly = false,
): Set<string> {
  const ids = new Set<string>();
  const pending = departments.some((d) => d.id === departmentId)
    ? [departmentId]
    : [];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    if (!directOnly)
      pending.push(
        ...departments.filter((d) => d.parentId === id).map((d) => d.id),
      );
  }
  return ids;
}
export function scopedMembers(members: readonly Member[], ids: Set<string>) {
  return members.filter((m) => m.active && ids.has(m.departmentId));
}
export interface Employee {
  id: string;
  userId: string;
  memberships: Member[];
}
export function employees(members: readonly Member[]): Employee[] {
  const rows = new Map<string, Employee>();
  for (const member of members) {
    const row = rows.get(member.userId) ?? {
      id: member.userId,
      userId: member.userId,
      memberships: [],
    };
    if (!row.memberships.some((m) => m.departmentId === member.departmentId))
      row.memberships.push(member);
    rows.set(member.userId, row);
  }
  return [...rows.values()];
}
