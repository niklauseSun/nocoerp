import type { DatabaseManager } from '@nocobase/db';
import { buildFilter } from '@nocobase/repository-input';
import { ApiError } from '@nocobase/app-server/router';
import type { LogQuery, OperationLog } from './model.js';
export class OperationLogs {
  constructor(readonly db: DatabaseManager) {}
  private repo() {
    return this.db.connection().repository<OperationLog>('hylOperationLogs');
  }
  append(row: OperationLog) {
    return this.repo().createOne({ values: row });
  }
  async list(q: LogQuery) {
    const filter = buildFilter((f) =>
      f.and([
        ...(q.q
          ? [
              f.or(
                [
                  'id',
                  'actorId',
                  'actorName',
                  'action',
                  'targetId',
                  'requestId',
                ].map((k) => f.string(k).includes(q.q)),
              ),
            ]
          : []),
        ...(q.module ? [f.string('module').eq(q.module)] : []),
        ...(q.result ? [f.string('result').eq(q.result)] : []),
        ...(q.from ? [f.date('createdAt').notBefore(q.from)] : []),
        ...(q.to ? [f.date('createdAt').notAfter(q.to)] : []),
      ]),
    );
    const repo = this.repo();
    const total = await repo.count({ filter });
    const data = await repo.findMany({
      filter,
      sort: (s) =>
        q.order === 'asc'
          ? [s.field('createdAt').asc(), s.field('id').asc()]
          : [s.field('createdAt').desc(), s.field('id').desc()],
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return { data, meta: { total, page: q.page, pageSize: q.pageSize } };
  }
  async get(id: string) {
    const row = await this.repo().findOne({ filter: { id } });
    if (!row)
      throw new ApiError({
        status: 'NOT_FOUND',
        reason: 'OPERATION_LOG_NOT_FOUND',
        domain: 'operationLogs',
        message: 'Operation log not found',
      });
    return row;
  }
}
