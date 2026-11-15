# 商家端微信小程序 · ERP 接入

默认入口 `pages/erp/index` 使用 ERP 接口，不读取演示存储，不提供模拟缴费或微信支付。旧预览代码留作历史开发参考，未注册为页面，并从默认打包清单排除；本地演示数据不会导入 ERP。

## 启用测试环境

1. 在目标 ERP 执行 `pnpm nocobase db apply`，应用迁移 `202611150001_merchant_miniapp`。将 `MERCHANT_MINIAPP_ENABLED=true`、`MERCHANT_MINIAPP_APP_ID`、`MERCHANT_MINIAPP_APP_SECRET` 注入 ERP 服务端后重启。功能默认关闭。登录限流默认每个连接来源每分钟 120 次，经过反代时会按代理地址共享额度；请在入口按客户端限流，并按试点规模设置服务端 `MERCHANT_MINIAPP_SIGN_IN_PER_PEER_LIMIT`。Secret 只在服务器环境变量或密钥存储，不能填进小程序、代码库或群聊。
2. 在微信开发者工具导入本目录，为该环境配置真实小程序 AppID。把 ERP HTTPS 地址（包含部署路径，例如 `https://erp.example.test/main`）写到 [erp-config.js](lib/erp-config.js)。在微信后台配置该域名的 request、uploadFile、downloadFile 合法域名，检查手机号组件权限和用户隐私保护配置。
3. 在 ERP 中准备至少两个测试商户，并给要报送的日期配置有效合同，为报修绑定可用资产。发布一张测试账单。
4. 系统管理员打开 ERP 的 `<部署路径>/api/swagger/docs`，在 **Merchant mini-program** 下用对应商户 UUID 执行 `PUT /api/merchantMiniapp/merchants/{merchantId}/grants`，请求体为 `{"phone":"<经确认的11位中国大陆手机号>","active":true}`。同一手机号可以在多个商户分别授权。GET 同一路径查看授权列表；传 `active:false` 撤销。员工/财务角色和联系人档案不因此改变。不要向自动生成的微信商家账号分配 ERP 管理角色。
5. 使用已授权的微信测试号打开小程序并同意手机号授权。后端分别校验微信登录码与手机号授权码，校验返回的 AppID，绑定该小程序身份后用 Better Auth 签发会话。普通 ERP 登录会话不具备小程序访问资格。小程序会话仅保存在小程序进程内存，退出后重新授权；手机号与首次绑定不一致时拒绝登录，不自动转移账号。

## 验收

- 切换已授权商户；不同商户的报送、账单、报修和附件互相隔离。未授权的普通联系人手机号不能进入。
- 填写营业额、订单数和备注。保存草稿后把 PNG/JPEG 凭证上传到 ERP；至少一张图片才能提交审核。每商户每天只允许一份小程序汇总报送；有既有 ERP 报送的日期不能再从小程序重复录入。已提交由 ERP 审核，退回后可继续编辑。ERP 报送详情展示订单数。
- 账单页只显示 ERP 已发布账单及其最新未结余额。没有小程序线上支付、模拟收款、退款或核销入口。
- 选择当前商户绑定的资产提交报修。ERP 派单、处理、验收、关闭后，在小程序刷新状态并查看进度时间线。
- 撤销其中一家商户授权。现有会话发出的后续请求不能继续读取或写入该商户，旧凭证链接也不能打开；其它授权不变。最后一家被撤权后无法继续使用，也不能重新登录取得新会话。已完成的 ERP 业务记录与凭证不会删除。

部署前用上述步骤跑一次微信开发者工具和真机。仓库自动化使用真正的应用 HTTP、临时数据库、附件流和 Better Auth 会话，仅替换外部微信服务响应。它不验证真实 AppID、微信授权配额、设备图片 API 或域名配置。

```sh
NODE_OPTIONS=--import=tsx node_modules/.bin/vitest run tests/merchant-miniapp tests/miniapp
```

微信文档：[登录凭证校验](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)、[手机号授权码换取号码](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html)。
