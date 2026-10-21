# 支付即开票

- 应用业务位于 `server/invoicing/`、`server/routes/invoicing.ts`、`client/pages/invoicing/`，只模拟蓝票和红票；不调用税务接口、真实支付或邮件。入口 `/invoicing`，page grant `hyl-invoicing`。
- 开票依据是已发布账单的有效现金核销与有效押金抵扣；未核销余额、单纯押金收取、经营代收、结算返款和合作方分账不构成开票额度。原始资金流水是权威，发票不改变应收、余额、退款或日结。
- 固定已发布账单费用行按稳定 billLineId 顺序，用 BigInt 顺序剩余比例法分摊累计已付金额；每行 floor(remainingPaid*weight/remainingWeight)，最后行取余。此法使补收时每行额度单调不减；不能改成会出现 Alabama paradox 的最大余数法。配置勾选费类不改变原权重。
- 每行净票=成功蓝票−成功红票。可开=max(已付−净票,0)，按当前启用配置过滤；待红冲=max(净票−已付,0)，不受费类勾选影响。有缺口先红冲。
- 蓝票逐行按含税额和演示税率拆税；红票逐原蓝票行用累计红冲比例分摊原不含税额，再减已红不含税额，保证全红尾分准确。红票一对一关联原蓝票且永不撤销。退款红冲受缺口约束，更正红冲可用未红余额；两者均需原因和依据。
- `recalculateBill` 只标记 transaction-local dirty queue；独立 BillingService.mutate、CashierService.atomic、LeaseService 最外事务在全部资金步骤完成后 flush 一次。内部 BillingService.transactionScope 共用队列，禁止提前出自动票，尤其退款的逆核销/重建保留额中间状态。错误/rollback 清理队列。
- 自动蓝票仅在该次事件使已付增加、配置启用且资料完整、没有待红冲时执行；配置启用 autoIssue 需要 invoiceConfigure+invoiceIssue，保存授权人/版本及来源经办人，不扩大收银员权限。保存配置不回溯自动出票，红冲不自动重开。已知人工模拟失败只写 attempts；未知代码/数据库异常完整回滚。
- GET 只读；历史来源由显式预览/补建办理。操作先鉴权再读幂等结果，同 merchant CAS 锁；actor+intent+requestId 指纹、source/version/config/preview hash 全部校验。未知结果同 requestId 重试。
- `invoiceRead/Configure/Issue/Red/Backfill` 复用合同复合资源并叠加原合同、账单及相关明细策略；仅编辑配置时需 invoiceConfigure 与合同 read，无需取得账单或票据查看权。跨合同票据必须全部成员可见才能整票返回和计入列表 total。失败合并开票按每个来源记录其自身金额/输入，不能向其中一个来源泄漏其他成员。历史已结清合同仍可更正票据，但不得重开资金业务。
- 票据快照不可编辑/删除；配置只增版本。新票逐行快照配置版本和授权人，历史缺失字段不得用当前配置倒填。原单关联使用有限的本地子路由；本地列表和详情分页查询参数带自身路径命名空间，关闭只清理自己拥有的参数并恢复焦点。来源叶节点不继续展开循环链接。
- `tests/invoicing/` 覆盖金额、迁移、事务队列、完整收银退款和红冲链、合并票权限范围、页面行为；原计费/收银/租赁/分账是受影响消费者。演示记录和核对公式见 `docs/支付即开票流程.md`。
