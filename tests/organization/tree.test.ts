import { describe, expect, it } from 'vitest';
import { activeChain, departmentsOf } from '../../server/organization/tree.js';
const tree = [
  { id: 'root', parentId: null, active: true },
  { id: 'a', parentId: 'root', active: true },
  { id: 'b', parentId: 'root', active: false },
  { id: 'c', parentId: 'b', active: true },
];
describe('organization inheritance', () => {
  it('includes active ancestors without duplicate subjects', () =>
    expect(
      departmentsOf(tree, [
        { departmentId: 'a', active: true },
        { departmentId: 'root', active: true },
      ]),
    ).toEqual(['a', 'root']));
  it('disabling an ancestor excludes the whole chain', () =>
    expect(activeChain(tree, 'c')).toBeUndefined());
  it('cycles and missing parents fail closed', () => {
    expect(
      activeChain([{ id: 'a', parentId: 'a', active: true }], 'a'),
    ).toBeUndefined();
    expect(
      activeChain([{ id: 'a', parentId: 'missing', active: true }], 'a'),
    ).toBeUndefined();
  });
  it('inactive memberships grant nothing', () =>
    expect(departmentsOf(tree, [{ departmentId: 'a', active: false }])).toEqual(
      [],
    ));
});
