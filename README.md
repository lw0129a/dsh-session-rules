# dsh-session-rules · 会话守则

给**单个会话**设置守则的 DeepSeek Harness 插件：在对话框顶部的「会话守则」按钮里写下这一轮对话的注意事项、约束或编码规范，保存后从**下一轮**开始进入该会话的系统提示词。其他会话不受影响，也不会修改任何项目文件或 Harness 文件。

典型用途：

- **注意事项**：这一轮别动某个目录、别升级依赖、改完先跑测试。
- **编码规范**：缩进、命名、注释语言、提交信息风格。
- **导入项目现有规范**：把项目里已有的 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` 等**只读**复制进本会话守则，原文件不动。
- **稍后版本**（0.2）：从当前对话里提炼关键信息并保存/优化。

## 安装

```bash
dsh plugin --profile desktop add /path/to/dsh-session-rules
```

装好后重启 DeepSeek Harness。重启后打开任意会话，输入框上方工具栏会出现「会话守则」按钮。

（GitHub 发布后也可直接 `dsh plugin --profile desktop add dsh-session-rules`。）

## 使用

1. 点「会话守则」。
2. 直接写，或点「导入项目规范」勾选要复制的文件。
3. 「保存」→ 下一轮对话生效；清空内容再保存 = 取消注入。

守则保存在 `~/.dsh/plugin-data/dsh-session-rules/rules.json`（`DSH_HOME` 可覆盖），按会话 id 分开存放。

## 安全与边界

- 不修改 Harness 的 app 文件，也不修改项目的规范文件；导入只读取文本。
- 注入内容按原样进入系统提示词，不做 `{{变量}}` 插值。
- HTTP 路由与 Harness 其他插件一致，校验 `connection.requestRejection`，未授权请求一律拒绝。
- 单条守则上限 100 K 字符，导入单文件上限 20 K 字符（超出截断并在文本中注明）。

## 开发

```bash
npm test          # 自检：会话 id 归一化、存储读写、注入取值
```

- `src/index.js`：宿主端。注册 `systemPrompt` 段落（每次组装提示词时按当前会话 id 取守则）和一个 `webServer` 精确路由。
- `src/client.js`：浏览器端。会话头部按钮 + 弹窗编辑器。
- `cordis.patch.yml`：安装为 bundle 时插入的插件行。

## License

MIT
