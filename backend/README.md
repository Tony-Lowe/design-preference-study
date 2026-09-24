# 腾讯云开发自动收卷中转站

参与者在原网页完成 24 项判断。每项选择立即保存在浏览器并进入下一题，整份答卷完成时自动 POST 到腾讯云开发；失败则每 15 秒、恢复联网时和重新打开网页时重试。参与者不需复制、粘贴或登录。收到中转站的确认后，网页才显示「可以关闭页面」。管理员随后将中转站答卷导入原结果库；参与者撤回会进入撤回队列，并在管理员同步时从原结果库删除。

## 当前状态

CloudBase 环境 `design-study-relay-d9cp7bd7e59fe`（上海）、私有集合 `study_relay_answers`、HTTP 云函数 `design-study-relay` 和 HTTPS 网关路由已经部署。中转地址为 `https://design-study-relay-d9cp7bd7e59fe-1312336060.ap-shanghai.app.tcloudbase.com/study-relay`。2026-09-24 已验证健康检查、GitHub Pages 来源的跨域响应、完整答卷写入、管理员读取及撤回清理。大陆手机网络的实际可达性仍需参与者试用确认。

## 云端开通与部署

1. 登录[腾讯云开发控制台](https://console.cloud.tencent.com/tcb)，在中国大陆地域创建 CloudBase 环境，记录环境 ID。腾讯云目前提供每账号一个免费体验环境、每月 3000 资源点；以控制台当前实际选项为准。免费环境可用云函数和文档型数据库。**云托管容器不在免费资源点环境内**，因此本目录使用 HTTP 云函数。参见[价格文档](https://cloud.tencent.com/document/product/876/75213)、[资源点计费](https://cloud.tencent.com/document/product/876/127357)。
2. 在环境的文档型数据库创建集合 `study_relay_answers`，权限设为仅管理端可读写。不要开放浏览器直连该集合。
3. 设置云函数的环境变量：`CLOUDBASE_ENV_ID=<环境 ID>` 和 `STUDY_RELAY_ADMIN_KEY=<管理码>`。在创建页打开“API Key 设置”，选择云开发 API Key 注入，使 HTTP 云函数中的 Node SDK 可以访问私有数据库。建议管理码与现有研究 API 的 `STUDY_ADMIN_KEY` 相同，以便管理员页面导入；管理码只在服务端保存，不能放进 GitHub、前端构建变量或网址。
4. 先在 `tencent-relay` 目录运行 `npm ci`，再运行 `python3 scripts/package_tencent_relay.py` 得到包含运行依赖的 `tencent-relay/tencent-relay-function.zip`。在控制台创建 **HTTP 云函数** `design-study-relay`，选择 Node.js 22.21、代码包上传、入口使用 `scf_bootstrap`，监听 9000 端口。也可安装官方 `@cloudbase/cli`，将 `cloudbaserc.example.json` 复制为本地 `cloudbaserc.json`、填入环境 ID，再执行 `tcb fn deploy design-study-relay`；配置里 `public: true` 和 `gatewayPath: /study-relay` 用于开放匿名 HTTP 网关。CLI 认证需由账号持有人完成。
5. 在 HTTP 网关查看实际 HTTPS 默认域名，添加 `/study-relay` 路由并绑定 HTTP 云函数。免费体验版不能添加自定义网关跨域域名，因此关闭此路由的网关“跨域设置”，由 `server.mjs` 自行校验允许的 Origin 并返回 CORS 响应头。中转地址是 `https://<实际域名>/study-relay`，`GET <中转地址>/health` 应返回 `ok: true` 和研究版本。测试 `OPTIONS` 跨域预检、完整 `POST /answers`、管理员导入和撤回。默认域名有访问频率、有效期与稳定性限制，适合试运行；正式大规模收集需绑定符合腾讯云要求的自定义域名。参见[HTTP 访问服务](https://cloud.tencent.com/document/product/876/122894)与[函数部署](https://docs.cloudbase.net/cli-v1/functions/deploy)。

HTTP 云函数通过只注入服务端的 CloudBase API Key 操作数据库；参与者不持有数据库凭据。`STUDY_ALLOWED_ORIGINS` 可选，默认只允许当前 GitHub Pages 与 Sites 前端。中转站保存首次成功上传时网关提供的 IP 供管理员核查，缺失时记为 `null`。

## 接入现有页面

验证中转站后，以真实地址构建 GitHub Pages：

```sh
VITE_STUDY_API=https://canvas-preference-study.tonylowe001031.chatgpt.site \
VITE_STUDY_RELAY=https://<实际域名>/study-relay \
npx vite build --config vite.static.config.mts
```

设置 `VITE_STUDY_RELAY` 后，参与者端只向中转站自动提交完整答卷，不再逐题请求原 API。管理员页面仍通过原 API 查看统计并点击「读取并导入」同步中转站。中转站对参与 ID 和 token 去重，管理员导入也会去重。若中转未确认，完成页明确要求保持页面打开，且会自动重试；关闭后再次打开仍会继续重试。

发布前用 `?preview=1` 在**大陆手机网络**做完整端到端测试：24 项选择 → 中转站确认 → 管理员导入 → 统计可见 → 撤回 → 管理员同步撤回 → 结果库中会话消失。不能仅以从海外机器访问 `/health` 判断大陆可达。

## 接口与本地验证

- `GET /health`：健康与数据版本。
- `POST /answers`：完整答卷上传，重复提交同一内容安全。
- `DELETE /answers`：参与者凭本机 token 撤回，生成待处理撤回记录。
- `GET /admin/answers`、`POST /admin/ack`：管理员导入并确认答卷。
- `GET /admin/withdrawals`、`POST /admin/withdrawal-ack`：管理员处理撤回。

管理员接口需要 `Authorization: Bearer <STUDY_RELAY_ADMIN_KEY>`；参与者来源通过 origin 白名单限制。运行 `npm ci && npm test` 检查答卷顺序、去重、跨域及撤回逻辑。更换 `data/offline-cases.json` 后，要先运行 `python3 scripts/build_tencent_manifest.py`，再重新部署中转站。
