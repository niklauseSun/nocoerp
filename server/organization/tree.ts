export interface TreeNode {
  id: string;
  parentId: string | null;
  active: boolean;
}
export function activeChain(
  tree: readonly TreeNode[],
  id: string,
): string[] | undefined {
  const nodes = new Map(tree.map((x) => [x.id, x])),
    seen = new Set<string>(),
    chain: string[] = [];
  let next: string | null = id;
  while (next) {
    const row = nodes.get(next);
    if (!row?.active || seen.has(next)) return;
    seen.add(next);
    chain.push(next);
    next = row.parentId;
  }
  return chain;
}
export function departmentsOf(
  tree: readonly TreeNode[],
  memberships: readonly { departmentId: string; active: boolean }[],
): string[] {
  return [
    ...new Set(
      memberships.flatMap((m) =>
        m.active ? (activeChain(tree, m.departmentId) ?? []) : [],
      ),
    ),
  ];
}
