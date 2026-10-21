import type { FileRecord } from '#extensions/nocobase-file-component-ui/index';
export type ProfileType = 'license' | 'visit' | 'contact';
export interface ProfileRecord {
  id: string;
  merchantId: string;
  type: ProfileType;
  actor: string;
  createdAt: string;
  date: string;
  payload: Record<string, string | boolean>;
  file?: FileRecord;
}
export interface ProfileList {
  data: ProfileRecord[];
  meta: { total: number; page: number; pageSize: number };
}
export const recordFields = {
  license: ['name', 'category', 'number', 'start', 'end', 'permanent', 'notes'],
  visit: ['date', 'person', 'channel', 'content', 'outcome', 'nextDate'],
  contact: ['date', 'person', 'channel', 'content', 'outcome', 'nextDate'],
};
export const recordPath = (id: string, type: ProfileType) =>
  `merchants/${encodeURIComponent(id)}/${type === 'license' ? 'licenses' : 'interactions'}`;
export const pageKeys = {
  license: 'licensePage',
  visit: 'visitPage',
  contact: 'contactPage',
};
export const routeSegments = {
  license: 'licenses/new',
  visit: 'visits/new',
  contact: 'contacts/new',
};
