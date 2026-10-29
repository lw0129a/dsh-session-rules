# dsh-session-rules · 会话守则

给 DeepSeek Harness 设置会话守则的插件。工作区行 `⋯` 菜单的「会话守则」和侧边栏底部「工作区守则」按钮打开同一个编辑框，按工作区（目录）维护守则，目录有层级时子目录只能勾选是否沿用上层、改不了上层；会话行 `⋯` 菜单的「会话守则」里写本会话的守则，并只读预览会沿用哪些工作区守则。保存后从**下一轮**开始生效。所有开关**默认关闭**：写完内容还要勾「对本会话生效」/「对本会话启用工作区守则」才会进入系统提示词（关掉时内容保留、不注入）。不会修改任何项目文件或 Harness 文件。

典型用途：

- **注意事项**：这一轮别动某个目录、别升级依赖、改完先跑测试。
- **编码规范**：缩进、命名、注释语言、提交信息风格。
- **优化描述**：调当前会话所用的模型（harness 的 LLM 服务，跟随 App 里配置的 provider/model）把草稿整理成可执行的条目，结果不会直接覆盖：弹窗先并排展示「原描述 / 新描述」（都可复制，新描述可改），点「替换原描述」才生效。模型不可用时按钮只是报错，手写不受影响。
- 输入框里**每行自动是「- 」开头**的条目：前缀在输入或换行时自动补上、删不掉；空行保留用于分组。
- **导入项目现有规范**：把项目里已有的 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` 等**只读**复制进本会话守则，原文件不动。
- **稍后版本**（0.2）：从当前对话里提炼关键信息并保存/优化。

工作区行 `⋯` 菜单没有官方扩展槽位，那一项是靠 DOM 增强加进去的（复用内置菜单项的样式与键盘行为）；DSH 改侧栏结构时它可能失效，失效时底部按钮仍在。

## 安装

```bash
dsh plugin --profile desktop add /path/to/dsh-session-rules
```

装好后重启 DeepSeek Harness。重启后打开侧栏会话列表，每个会话右侧的 `⋯` 菜单里有「会话守则」一项。

也可以直接从 GitHub 装（会自动构建 `dist/`）：

```bash
dsh plugin --profile desktop add github:lw0129a/dsh-session-rules
```

或从 npm 装：

```bash
dsh plugin --profile desktop add dsh-session-rules
```

## 使用

1. 在会话行 `⋯` 菜单里点「会话守则」。
2. 直接写，或点「导入项目规范」勾选要复制的文件。
3. 「保存」→ 下一轮对话生效；清空内容再保存 = 取消注入。

守则保存在 `~/.dsh/plugin-data/dsh-session-rules/rules.json`（`DSH_HOME` 可覆盖），按会话 id 分开存放；工作区守则存在 `ws:<工作区绝对路径>` 键下（例如 `ws:/Users/lw/dev`）；层级由路径本身推导：`~/.dsh/storages/workspace.json` 里已登记的工作区，加上它们所在但没登记的父目录（在家目录以下、非根目录），每一层都能单独保存守则；每个工作区用 `inherit` 记录它勾选沿用的祖先路径。旧版本按会话树目录名存的 `ws:--Users-lw-dev--` 会在读取时自动改写为 `ws:/绝对路径`。注入顺序是「已启用的上层（由外到内）→ 本层 → 本会话」。

## 安全与边界

- 不修改 Harness 的 app 文件，也不修改项目的规范文件；导入只读取文本。
- 注入内容按原样进入系统提示词，不做 `{{变量}}` 插值。
- HTTP 路由与 Harness 其他插件一致，校验 `connection.requestRejection`，未授权请求一律拒绝。
- 单条守则上限 100 K 字符，导入单文件上限 20 K 字符（超出截断并在文本中注明）。

## 开发

TypeScript 源码在 `src/`，`tsc` 编译到 `dist/`。npm、pnpm 均可：

```bash
npm install && npm run build   # 或 pnpm install && pnpm build
npm test                        # 构建 + 自检：会话 id 归一化、存储读写、注入取值
```

- `src/index.ts`：宿主端。注册 `systemPrompt` 段落（每次组装提示词时按当前会话 id 取守则）和一个 `webServer` 精确路由。
- `src/client.ts`：浏览器端。tsc 直接产出的 classic script（`__ModuleLoader__` 工厂），不经过打包器；侧栏会话行 `⋯` 菜单项 + 弹窗编辑器。
- `tsconfig.json`：与 `dsh-app-packager` 插件同构（ES2022 / nodenext / declaration）。
- `cordis.patch.yml`：安装为 bundle 时插入的插件行。

从 git 安装时先 `npm run build`（或 `pnpm build`）生成 `dist/`；`dsh plugin add` 本地目录依赖它。

## License

MIT
