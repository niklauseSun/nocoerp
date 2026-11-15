# 商家微信小程序与 ERP

- 原生小程序在 `miniapp/`，默认 `pages/erp/index`，不使用 React/shadcn。文案在 `lib/erp-copy.js`，HTTPS ERP 地址在 `lib/erp-config.js`。旧本地预览未注册为入口且不打包；不得自动回退到演示记录。上线及验收见 [小程序说明](../../miniapp/README.md)。
- `server/merchant-miniapp/` 定义微信协议、授权与业务适配。用配置 AppID 校验微信登录及手机号 code，AppID+OpenID 摘要绑定专用 Better Auth 用户，单次凭证摘要防重放。手机号与已绑定不一致时拒绝。内部无路径 Better Auth 端点仅由校验成功后的服务端路由调用，不另造会话；小程序只在内存持有 bearer token。样例、日志和客户端不得写 AppSecret、登录码或令牌。
- 系统管理员通过 `/api/merchantMiniapp/merchants/{merchantId}/grants` 管理独立授权，普通联系人手机号不能代替授权。专用用户不自动加角色，不绑定商户旧 `userId`。每次业务或凭证访问从数据库重新检查当前 AppID、有效商户和授权；报送与报修写入在商户锁内再次检查，授权修改使用同一锁。内部服务策略只许可选中的商户、指定资产和已列举的动作；不会提升全局权限。
- 报送复用 ERP 审核与结算账本。小程序每天每商户一份汇总报送，日索引和草稿同时提交；日索引防止重复汇总，但保留旧 ERP 按渠道报送历史。订单数是既有 payload 中的可选字段，后台对旧记录仍兼容。凭证沿用原有私有 File Repository；仅报送可编辑状态可上传，提交时至少一份凭证。
- 账单只显示已发布应收，金额与余额由 ERP 账单服务计算；报修创建和进度沿用原工单及事件。无微信支付、模拟收款或任何新增财务写入。
- `tests/merchant-miniapp` 用测试微信响应、真实应用路由和临时数据库验证授权、审核、附件、账单、报修、撤权；迁移单独验证 up/down。`tests/miniapp` 不等同于微信开发者工具编译、真机和真实平台的验收。
