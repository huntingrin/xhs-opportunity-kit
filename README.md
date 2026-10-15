# XHS Opportunity Kit

把小红书上的潜在线索整理成有来源、有判断依据、可持续跟进的合作机会。

**TypeScript SDK + JSON CLI + 标准 stdio MCP 服务 + 通用 Agent Skill。** 本地 SQLite 保存状态，支持离线导入与可配置的小红书 MCP 连接。与小红书无官方关联。

第一版覆盖：搜索与详情读取、笔记去重、证据保存、人工/Agent 判断、规则筛选、业务状态记录、JSON/CSV 导出。它不发送消息、不发布内容、不自动接单，也不创建后台定时任务。

## 安装

需要 **Node.js 22.13 或以上**。使用 Node 内置 SQLite，无需另外安装数据库。部分 Node 版本会向 stderr 输出 SQLite 实验性提示，stdout 仍是纯 JSON。

安装 GitHub Release 中的已编译包（无需 TypeScript 编译器）：

```sh
npm install -g https://github.com/huntingrin/xhs-opportunity-kit/releases/download/v0.1.0/huntingrin-xhs-opportunity-kit-0.1.0.tgz
xhs-opportunity --help
xhs-opportunity doctor
```

源码开发：

```sh
git clone https://github.com/huntingrin/xhs-opportunity-kit.git
cd xhs-opportunity-kit
npm ci
npm test
node examples/quickstart.mjs
```

目前通过 GitHub 分发，**尚未发布 npm registry 包**。不要使用 `npm install @huntingrin/xhs-opportunity-kit`，除非你确认它日后已在 registry 发布。其他 Node 项目可以 `npm install <上面的 tgz URL>` 后导入同名 SDK。

## 任何 Agent 如何使用

| 环境能力 | 接入方式 |
| --- | --- |
| 能执行命令 | 调用 `xhs-opportunity`，通过文件或 stdin 传 JSON，解析 JSON 结果 |
| 支持 MCP | 启动 `xhs-opportunity-mcp`，发现并调用 10 个标准工具 |
| 能运行 JS/TS | 导入 SDK，注入自己的数据提供器 |
| 支持 Skill | 加载 `skills/xhs-opportunity-kit/SKILL.md`，作为工作流指南 |
| 只有聊天、不能调用工具 | 不能直接执行本项目；需由宿主提供以上一种执行能力 |

CLI 是跨 Agent 的基础入口；Skill 不绑定 Codex、Cola 或特定模型。小红书登录和连接需要由使用者自行配置，不随安装包分发。没有平台连接也能处理已有数据。

## 五分钟离线演示

仓库中的示例全部为虚构数据。以下命令从仓库根目录执行：

```sh
node dist/cli.js collect --db ./demo.sqlite --input examples/collect-file.json
node dist/cli.js list --db ./demo.sqlite
node dist/cli.js export --db ./demo.sqlite --input examples/export-csv.json --output ./demo.csv
```

输出始终为 `{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": { "code": ..., "message": ... } }`。

- 退出码 `0`：操作成功；`1`：错误；`3`：采集部分完成或失败，检查 `data.status/errors/warnings`。部分结果已经保存。
- 真实小红书搜索端点没有完整结果范围保证，因此正常采集也可能是 `partial`。不要把它改报成“全部搜索完成”。
- 重新执行同一采集不会重复新增同一笔记。进程中断后可重跑；已保存数据保留，中断运行可能保留 `running` 状态，须结合进程状态判断。不会自动重放旧游标。

## 接入真实搜索

复制 `examples/collect-mcp.json`，在仓库外填写你实际可访问的 MCP URL。认证令牌通过环境变量传入。也支持 stdio 与 SSE，见 [提供器接口](docs/providers.md)。

```sh
xhs-opportunity collect --input /path/to/your/collect-config.json
```

适配器调用 `search_feeds` 和 `get_feed_detail`。平台搜索、访问资格、登录和限流由上游工具处理。SDK 不提供账号、浏览器或登录状态，也不保证上游一直可用。

Agent 已经能读取小红书、但不能让本包直接连接同一工具时，可以使用自己的已授权工具收集内容，转换成 [标准 Note 数据](docs/api.md)，调用 `import`。无需重新实现登录。

## MCP 配置

通用配置结构如下，具体放置位置遵循你的 Agent 客户端说明：

```json
{
  "mcpServers": {
    "xhs-opportunity-kit": {
      "command": "xhs-opportunity-mcp",
      "args": ["--db", "/absolute/path/to/opportunities.sqlite"]
    }
  }
}
```

如客户端找不到全局可执行文件，可用 `node` 配合已构建项目的绝对路径 `dist/mcp-server.js`。需要 MCP 工具直接采集时，在启动参数增加 `--provider /absolute/path/to/provider.local.json`。配置只包含 provider 对象，示例见 `examples/provider-mcp.json`。

## 证据和状态

- 筛选等级 `priority / pending / excluded` 与业务阶段 `discovered / contacted / requirements_review / accepted / delivered / closed` 分开保存。
- `review` 必须引用 `show` 返回的证据 ID。未知预算、未知 AI 接受度不会自动判为符合要求。
- 原帖内容更新会标记 `reviewStale`；规则筛选不继续使用过期判断。
- `stage` 仅记录已发生的事实，不会真的联系客户或交付文件。
- 从旧的 `lead-delivery.json` 导入时，旧结论保存为历史证据，进入待复核状态，不当成当前有效客户。
- 搜索卡片不会覆盖已有详情。时间、评论覆盖范围、部分失败会保留。

## 数据与依赖

默认数据库放在系统用户数据目录下的 `xhs-opportunity-kit/`，不写入安装目录。可用 `XHS_OPPORTUNITY_DATA_DIR` 或 `--db` 指定。`doctor` 不验证平台登录。

本包只保存规范化字段，不保存原始响应中的 Cookie、访问令牌或带签名的 URL。正文、作者与评论仍可能包含个人信息，属于你的本地数据；导出前按你的使用场景审阅。示例、测试与发布包不含真实账户、线索或运行资料。

现有截图表格中的图像文字可由宿主 OCR 后作为 `image_text` 证据导入。本版没有内置 OCR、LLM、私信收发、邮件轮询、网页界面或 Excel 排版引擎；这些可以通过适配器或上层应用扩展。

## 文档与维护

- [CLI 请求和错误契约](docs/cli.md)
- [SDK、数据模型和状态转换](docs/api.md)
- [连接适配器与兼容边界](docs/providers.md)
- [English quick start](docs/english.md)
- [Agent Skill](skills/xhs-opportunity-kit/SKILL.md)

```sh
npm run check
npm test
npm pack
```

合成测试覆盖核心业务行为、CLI 子进程和真实 MCP 协议连接。CI 验证 Linux / macOS / Windows 与多个 Node 版本。线上功能是否可用仍取决于使用者的 MCP 服务与平台会话。MIT License。
