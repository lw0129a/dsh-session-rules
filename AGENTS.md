# AGENTS.md — 给 AI 编码助手与本仓库维护者的规则

本仓库的 AI/开发规范。规范主体拷贝自 [`dsh-app-packager`](../dsh-app-packager/AGENTS.md)，
按本插件的形态删改：这里只有一个包，宿主侧跑在 Node，浏览器侧跑在 Web 渲染进程。

## 1. 这个仓库是什么

DeepSeek Harness 插件 `dsh-session-rules`：给工作区和会话各写一份「守则」，注入系统提示词。

- `src/index.ts` —— 宿主侧（Node）：注册 systemPrompt 段、`/__chameleon/session/rules` 路由、读写 `~/.dsh/plugin-data/dsh-session-rules/rules.json`。
- `src/client.ts` —— 浏览器侧：手写 `__ModuleLoader__` bundle（零构建），弹窗、工作区菜单的 DOM 增强。
- `dist/` —— `tsc` 产物，`npm publish` 与 profile 安装都只认 dist。
- `test/selfcheck.mjs` —— 唯一的测试，`npm test` = `npm run build && node test/selfcheck.mjs`。

## 2. 铁律（违反即视为未完成）

### 2.0 零影响原则（最高优先级，覆盖本文件其余条款）

插件的任何缺陷、配置错误或异常，都**不允许影响使用者的 DeepSeek Harness**：

- **绝不拖垮 Harness**：`apply()` 内每处注册都必须自己 try/catch，失败只 `warn` 并让插件自己失效；不允许出现 `entry did not activate` 级别的启动失败。宿主侧的段回调同样必须兜住异常（返回 `''`）。
- **浏览器 bundle 不得访问 Node 环境**：`dist/client.js` 里不允许出现 `process.` / `require(` / `__dirname` / `Buffer`。判断平台用 `isApplePlatform()` 这类浏览器安全函数（0.7.4 的 `process.platform` 直接把 Web 打崩过）。
- **只动自己的数据**：唯一写入点是 `~/.dsh/plugin-data/dsh-session-rules/rules.json`（原子写）；不碰使用者项目文件、不碰 `~/.dsh` 其它目录、不碰 Harness 安装目录与其它插件。
- **不接管别人的 UI**：侧边栏菜单项靠 DOM 增强注入，只 clone 内置项样式、只 append 自己那一项；DSH 改侧栏结构时允许它自然失效，不允许为此改 app 包。
- **破坏性动作先确认**：commit / push / npm publish / 删工作区或会话的守则之前先问；失败只报错并留日志。

### 2.1 发布与安装

- **不要在安装时构建**：不设 `prepare`（注册表安装不跑它，`file:`/git 安装跑它反而会把安装搞半截）。发布前用 `prepack` 出包，`dist/` 必须已经在 tarball 里。
- **版本递增**：行为变化 minor、修复 patch；`package.json` 的 `version` 与 commit 一起改。
- **装到本机 profile 只走 `dshp add <包@版本>`**：App 运行中禁止改 `node_modules`；不要传 `--config.registry` / `--config.resolution-mode`（会重解析全部依赖，把无关插件卸了又装）。
- **npm 上是正式渠道**：GitHub 与 npm 版本要一致；npmmirror 滞后时用 `--config.registry=https://registry.npmjs.org/` 装，装完再核对实际版本。

## 3. 常用命令

```bash
npm run build          # tsc -> dist/
npm test               # build + selfcheck（含浏览器 bundle 无 process.* 的回归断言）
node test/selfcheck.mjs
```

## 4. 代码规范

- 源码只有 TypeScript（`src/**/*.ts`）；`dist/` 是产物，不要手改。
- 不引入运行时依赖，不 import `@deepseek-ai/*`（宿主注入）；`react` 只在 `src/client.ts` 的 factory 闭包里 `require`，不写进 `dependencies`。
- `webServer` 不要写进宿主的硬 `inject`；用现有写法保持「没有 Web 服务时插件仍能激活」。
- 导出小工具函数保持纯函数（`idCandidates`、`layersOf`、`selectedLayers` 那一类），副作用集中在 `readStore`/`writeStore`/`apply`。
- 中文注释与文案是本仓库既有风格；标识符、配置键、日志里的技术名词用英文。
- 样式只用宿主的 `--dsw-alias-*` token，不硬编码颜色；弹窗宽度用 `fit-content` + `max-*` 上限。

## 5. 文档规范（中英双份）

- 英文 `README.md`、中文 `README.zh-CN.md`（旧文件 `README.en.md` 视为英文副本，改动时一并同步）。
- 每份面向用户的文档首行是语言切换行。
- 改了行为必须同步 README 里的「典型用途 / 生效范围 / 数据在哪」三节。

## 6. 提交与发布

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`，一次提交一件事。
- 发布：`npm publish --access public`（用一次性 npmrc 传 token，落地文件用完即删），随后 `gh repo` 与 npm 版本核对一致。
- 不要 `git push --force` 到 `main`；push 遇到 `Empty reply from server` / 443 超时重试即可，必要时 `-c http.version=HTTP/1.1`。

## 7. 完成前自检

1. `npm test` 全绿（含 bundle 无 `process.` 断言）。
2. 每个 `bundles` 条目都在 `node_modules`（`localteam check` 的 `bundles 自检`）。
3. 宿主 `apply()` 对坏 host 不抛异常（selfcheck 里有对应用例）。
4. `git status` 里没有用户守则内容、没有 `rules.json`。
