# 开发与内部实现

面向维护者。用户向说明见 [README.md](../README.md)。

## 目录结构

```
src/index.ts        宿主端（Node）：systemPrompt 段落 + 一个 webServer 精确路由
src/client.ts       浏览器端：tsc 直接产出的 classic script（__ModuleLoader__ 工厂），不打包
test/selfcheck.mjs  自检：会话 id 归一、存储读写、注入取值、缓存失效
cordis.patch.yml    作为 bundle 安装时插入的插件行
dist/               tsc 产物，安装时由 prepare/build 生成
```

## 命令

```bash
npm install && npm run build   # 或 pnpm install && pnpm build
npm test                        # build + node test/selfcheck.mjs
```

本地开发时 profile 用 `link:` 装（`~/.dsh/profiles/<profile>/cordis.patch.yml` 里一行 `dsh-session-rules  link:/path/to/dsh-session-rules`），改完 `npm run build` 后重启 App 生效。

## 注入链路

- `apply(ctx)` 里 `ctx.inject(['systemPrompt'])` 注册一个 section：`name: 'session-rules'`、`order: 10190`、`interpolate: false`，`text` 回调每次组装提示词时按当前会话 id 现取守则。
- `ctx.inject(['webServer'])` 注册精确路由 `GET|POST /__chameleon/session/rules`，只挂在 Harness 自己的 web server 上；请求先过 `connection.requestRejection`，未授权一律拒绝。
- 注入顺序：已勾选的祖先（由外到内）→ 本层 → 本会话，`'\n\n'` 连接，空串过滤。全部默认关闭，只有显式勾选才非空。

## 数据格式

`$DSH_HOME/plugin-data/dsh-session-rules/rules.json`：

```jsonc
{
  "session-<uuid>": { "rules": "…", "sources": [], "enabled": true, "inherit": ["/abs/ancestor"], "updatedAt": 0 },
  "ws:/abs/workspace": { "rules": "…", "sources": [], "inherit": ["/abs/ancestor"], "updatedAt": 0 }
}
```

- 会话键用 `session-<uuid>` 或裸 uuid（`idCandidates` 两种都认）。
- 工作区键是 `ws:<绝对路径>`；`inherit` 存祖先工作区的绝对路径数组（legacy 布尔 `true` 会归一成 `['*']` 表示整条链）。
- 读取时 `pruneStore` 顺手丢掉已不存在的会话/工作区；写入用 `${file}.${pid}.tmp` + `rename` 原子替换。
- `readStore()` / `workspaceRegistry()` 按文件 stamp（mtime+size）缓存，`workspaceForSession()` 有 memo，所以每轮注入不做磁盘 IO。

## 权限与影响范围

| 涉及 | 做什么 | 位置 |
| --- | --- | --- |
| 系统提示词 | 加一段 `session-rules` section（顺序 10190，不插值），只对勾选过的会话生效 | Harness `systemPrompt` 服务 |
| 插件数据（唯一会写的文件） | 守则正文、开关、逐层勾选；读取时清掉已删除工作区/会话的条目 | `$DSH_HOME/plugin-data/dsh-session-rules/rules.json` |
| 工作区列表（只读） | 取真实路径、标题、所属会话，用来算层级 | `$DSH_HOME/storages/workspace.json` |
| 会话目录（只读） | 判断会话属于哪个工作区、是否还存在 | `$DSH_HOME/sessions/**` |
| 本地 HTTP 路由 | 弹窗读写：`GET/POST /__chameleon/session/rules` | 本机，同源 |
| 模型调用 | 只有「优化描述」才调，走 Harness 已配置的 provider/model | Harness `llm` 服务 |
| 界面 | 会话行菜单项、两个弹窗、往工作区 `⋯` 菜单 DOM 增强插一项、注入一段弹窗样式 | Harness 侧边栏 / overlay |

不修改 Harness app 文件，不修改项目文件。

## 界面入口

- 会话行 `⋯` 菜单：官方 slot `sidebar.workspaces.session.menu.item`，`order: 201`（内置 `pin` 100 / `rename` 200 / `fork` 300 / `archive` 400 / `session-id` 450，升序渲染）。
- 工作区行 `⋯` 菜单：DSH 没有对应 slot，靠 DOM 增强——监听带 `data-row-key="workspace:<uuid>"` 的行，菜单打开后克隆首个 `menuitem` 的样式插一项，用行 id 匹配工作区。DSH 改侧栏结构时可能失效。
- 弹窗宽度自适应（`fit-content`，下限 `min(520px, 80vw)`、上限 80vw / 80vh），内容过高时弹窗内滚动。
