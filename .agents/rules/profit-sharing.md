# 自动分账

应用代码：`server/profit-sharing/`、`client/pages/profit-sharing/`；迁移 `202610180002_profit_sharing`。使用说明见 `docs/自动分账流程.md`。

- 规则不可变版本，按来源账期start选取，首次有效事件锁定rule快照；禁止为已核销/已确认来源补写追溯规则。续租需显式配置或复制。
- 账单只分有效现金allocate，押金/unused不入基数。经营结算以collected为来源，merchant payable沿用hylPayments，fee+rent合作分配，deductions归集；补缴按同settlement sourceId的有效lease collect/deduct计入，资金缺口未补齐不可执行。
- 每次原billing/lease/settlement mutation在原merchant锁和transaction中syncContract；GET不产生任务。sources变化追加revision，reviewedHash不同强制复核。整数累计最大余数分摊，禁止按每笔独立舍入。
- SplitService只处理partnerPay/recover/reverse与attempts；商户执行调用HylService.act内部事务入口，旧payments入口同样同步投影。不能另建商户付款账，不能嵌套独立事务。
- 共享原merchant锁、expectedVersion/sourceHash及actor+requestId+intent指纹；成功原子提交，幂等回放仍鉴权；reference跨原收款/押金/返款/分账校验。
- 页面只提供台账模拟，不发起真实支付。未决任务阻止closeLease，closed禁止资金操作。原没有规则的合同不改变行为。
- 日结新增partner支出、追回、更正一次；项目留存不算现金，merchant payout留在原返款统计。按createdAt的上海登记日，凭证日期单列。
- contracts复合资源splitRead/Configure/Review/Execute/Recover与来源的原权限共同生效，不默认扩权。reverse同时需Execute+Recover。
- 分账完整列表20条精确分页；关联卡片100条上限显式提示；详情子表独立分页。交叉链接保留origin路径与查询，来源叶页只读且有限，规则续租复制结果保留原位链路。
- 测试在tests/profit-sharing；修改后同时跑受影响billing/cashier/lease测试。所有演示保留审计，原有演示不重置。
