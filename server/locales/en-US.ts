import type { LocaleResource } from '@nocobase/i18n';
const enUS = {
  messages: {
    tenantNotice: 'A notice or policy awaits reading. Open Tenant services.',
    tenantServiceRequest:
      'A tenant request needs handling. Open Tenant services.',
    tenantServiceOverdue: 'A tenant request is overdue. Open Tenant services.',
    operationFollowup:
      'A business follow-up is due. Open Business todos to review.',
    settlementConfirm:
      'A settlement awaits confirmation. Open Business todos to confirm online or record offline confirmation.',
    title: 'Business reminder',
    contractExpired:
      'A contract has expired. Review its renewal or termination in Business todos.',
    contractExpiry:
      'A contract is approaching expiry. Review its renewal or termination in Business todos.',
    billOverdue:
      'An unpaid bill is overdue. Review collection in Business todos.',
    billDue:
      'An unpaid bill is approaching its due date. Review collection in Business todos.',
    repairDispatch:
      'A repair report needs dispatch. Open Business todos to review.',
    repairProcess: 'A repair needs processing. Open Business todos to review.',
    repairAccept:
      'A completed repair needs acceptance. Open Business todos to review.',
    repairClose:
      'An accepted repair needs closure. Open Business todos to review.',
    purchaseReview:
      'A purchase request needs review. Open Business todos to review.',
    purchaseOrder:
      'An approved request needs an order. Open Business todos to review.',
    purchaseIssue:
      'A purchase order needs issuing. Open Business todos to review.',
    purchaseReceive:
      'A purchase order has items awaiting receipt. Open Business todos to review.',
    purchasePay:
      'An accepted purchase has an unpaid balance. Open Business todos to review.',
    purchaseAccept:
      'A purchase receipt needs acceptance. Open Business todos to review.',
  },
};
export type AppServerResource = LocaleResource<typeof enUS>;
export default enUS;
