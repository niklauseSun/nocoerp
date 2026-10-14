import { defineLifecycle, type LifecycleTypes } from '@nocobase/lifecycle';
export const reportingLifecycle = (name: string) =>
  defineLifecycle<LifecycleTypes>({
    name,
    initial: 'draft',
    states: ['draft', 'pending', 'approved', 'returned'],
    transitions: {
      submit: { from: ['draft', 'returned'], to: 'pending' },
      approve: { from: 'pending', to: 'approved' },
      return: { from: ['pending', 'approved'], to: 'returned' },
      edit: {
        from: ['draft', 'returned'],
        to: ['draft', 'returned'],
        route: ({ record }) => String(record.status),
      },
    },
  });
export const settlementLifecycle = defineLifecycle<LifecycleTypes>({
  name: 'hylSettlements',
  initial: 'review',
  states: [
    'review',
    'confirmation',
    'disputed',
    'payable',
    'partial',
    { name: 'paid', final: true },
    { name: 'settled', final: true },
    { name: 'due', final: true },
    { name: 'cancelled', final: true },
  ],
  transitions: {
    review: { from: 'review', to: 'confirmation' },
    confirm: {
      from: 'confirmation',
      to: ['payable', 'settled', 'due'],
      route: ({ input }) =>
        Number(input.balance) > 0
          ? 'payable'
          : Number(input.balance) < 0
            ? 'due'
            : 'settled',
    },
    dispute: { from: 'confirmation', to: 'disputed' },
    cancel: { from: ['review', 'disputed'], to: 'cancelled' },
    pay: {
      from: ['payable', 'partial'],
      to: ['partial', 'paid'],
      route: ({ input }) => (input.complete ? 'paid' : 'partial'),
    },
  },
});
