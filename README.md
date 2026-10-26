# XHS Opportunity Kit

**帮你在小红书上找远程接单机会，先看 3 条，再决定联系谁。**

不用自己翻几百条笔记。它把公开的接单需求去重，按你的活类型、单价底线和时间筛一遍；每条都带原帖原话、要确认的问题和风险提示。

与小红书无官方关联；只读取公开内容，不登录、不私信、不自动接单。

## 适合谁

- 接远程活的自由职业者：剪辑、设计、写作、配音、运营、翻译……
- 想接单，但不想被“招募代理 / 卖课 / 坐班 / 收费试稿”浪费时间
- 已经在用支持 Skill、MCP 或命令行的 Agent

## 你会得到什么

先给 3 条最值得联系的，而不是一张几百行的表：

> **远程（明确）｜示例：远程短视频剪辑**
> 15 元/条 · 50 秒 · 每月 400 条起
>
> 原话：“招远程剪辑，15 元/条，50 秒内，长期稳定，月结。”
>
> 为什么适合：单价、工作量、交付时长都写清楚
>
> 先确认：是否直签 / 试稿 / 押金 / 结算周期
>
> 风险：招募方可能抽成
>
> 下一步：打开原帖 / 复制开场白 / 标记已联系

信息不够的放“值得问一句”；要求坐班、到岗的直接排除。需要时还能导出 CSV，或生成一份本地 HTML 报告。

先给 3 条，是因为你要的是能联系的活，不是一张需要自己再筛一遍的表。

## 怎么用（推荐）

### 1. 在 Agent 里加载这个 Skill

最简单：从 [ColaSkill](https://colaskill.com/zh/xhs-opportunity-kit/) 安装。手动安装的话，把 `skills/xhs-opportunity-kit/` 放进你的 Agent 技能目录。

技能目录里已经带了单文件 CLI（`skills/xhs-opportunity-kit/scripts/xhs-opportunity.mjs`；仓库和技能包版本自带，npm 包可能不含打包脚本），只要 Node，不需要 npm 安装；如果你的 Agent 能执行命令，可以直接用它。它只是操作指南，不会替你登录小红书；登录和验证由你本人处理。

### 2. 对 Agent 说

> 帮我找远程剪辑单，单价不低于 15 元/条，每天能投入 3 小时。先给我 3 条最值得看的。

它会先确认 3 件事：接什么活、单价或月收入底线、每天能投入多少。然后只看首屏 10–12 条，先给你 3 条；你挑靠谱的，它再扩。

### 3. 选一条开始联系

每条线索都带原帖链接和要确认的问题。这个包不会替你发私信，也不会自动接单；发送由你本人操作。

## 它不会做什么

- 不登录你的小红书账号，不绕过验证码
- 不私信、不发布、不自动接单、不创建定时任务
- 不保证搜全：小红书搜索没有完整翻页保证，报告会写清这次看了多少、缺什么
- 不替你判断对方是不是骗子；押金、培训费、免费试稿等风险会标出来，但要不要继续由你决定

## 远程规则

- 只把明确写“全程远程 / 线上办公 / 居家 / 不限地点 / 可异地”的放进“建议先联系”
- “可远程 / 远程优先 / 没写地点”放“值得问一句”
- 要求坐班、到岗、驻场、每周固定线下的直接排除
- 发布者所在地不是工作地点；“山东的作者”不等于“山东坐班”

## 数据与隐私

- 记录默认存在你电脑的应用数据目录，不写进项目文件夹；技术用户可以用 `--db` 指定位置
- 只保存规范化字段，不保存 Cookie、访问令牌或带签名的链接
- 正文、作者、评论可能包含个人信息；导出前按你的使用场景审阅
- 仓库里的示例和测试全部是合成数据

## 如果你会用命令行

需要 Node.js 22.13 或以上。

### 方式一：不安装，直接用技能目录里的单文件 CLI

`skills/xhs-opportunity-kit/scripts/` 下的两个入口已经内联依赖，只需 Node，不需要 npm 安装，也不会产生 `node_modules`：

```sh
node skills/xhs-opportunity-kit/scripts/xhs-opportunity.mjs doctor
node skills/xhs-opportunity-kit/scripts/xhs-opportunity-mcp.mjs --db /absolute/path/to/opportunities.sqlite
```

它们由 `npm run bundle:skill` 生成并随仓库提交。改过 `src/` 后需要重新生成。

### 方式二：源码开发

```sh
git clone https://github.com/huntingrin/xhs-opportunity-kit.git
cd xhs-opportunity-kit
npm ci
npm run build

node dist/cli.js demo --output demo.html   # 先看合成示例，不碰你的数据
node dist/cli.js doctor
```

### 方式三：安装 v0.1.0 Release（不含新命令）

```sh
curl -L -o huntingrin-xhs-opportunity-kit-0.1.0.tgz \
  https://github.com/huntingrin/xhs-opportunity-kit/releases/download/v0.1.0/huntingrin-xhs-opportunity-kit-0.1.0.tgz
npm install -g ./huntingrin-xhs-opportunity-kit-0.1.0.tgz
xhs-opportunity doctor
```

npm 12 默认拒绝直接安装远程 URL（`EALLOWREMOTE`）；先下载再本地安装即可。旧版 npm 可以直接 `npm install -g <tgz URL>`，或给 npm 12 加 `--allow-remote`。

真实搜索需要你配置一个可用的 MCP 连接，或者让 Agent 读取小红书后把笔记导入。配置见 [提供器接口](docs/providers.md)。

## 给开发者 / 集成

这个仓库同时提供：

- TypeScript SDK
- JSON CLI（`xhs-opportunity`）
- 标准 stdio MCP 服务（`xhs-opportunity-mcp`，12 个工具）
- 通用 Agent Skill（`skills/xhs-opportunity-kit/SKILL.md`）
- 技能目录内已内联依赖的单文件 CLI / MCP 入口

| 环境能力 | 接入方式 |
| --- | --- |
| 支持 Skill | 加载 `skills/xhs-opportunity-kit/SKILL.md` |
| 能执行命令 | 调用 `xhs-opportunity`，或技能目录里的单文件 CLI |
| 支持 MCP | 启动 `xhs-opportunity-mcp` |
| 能运行 JS/TS | 导入 SDK，注入自己的数据提供器 |
| 只有聊天、不能调用工具 | 不能直接执行本项目；需由宿主提供以上一种能力 |

常用命令：

```sh
npm run check
npm test
npm run bundle:skill     # 重新生成技能内置入口
npm run check:bundle     # 校验内置入口与源码同步
npm pack
```

文档：

- [CLI 请求和错误契约](docs/cli.md)
- [SDK、数据模型和状态转换](docs/api.md)
- [连接适配器与兼容边界](docs/providers.md)
- [English quick start](docs/english.md)
- [Agent Skill](skills/xhs-opportunity-kit/SKILL.md)

当前源码包含尚未发布的 0.2 功能（远程工作方式、单价/工作量/风险、CSV 中文表头、HTML 报告/示例）；v0.1.0 Release 和它对应的技能内置入口都不含这些命令。发布 0.2.0 前请从源码构建或使用本地打包。

## 和平台的关系

本项目与小红书无官方关联，不提供账号、登录状态或平台授权。请遵守平台规则，不要高频抓取。登录、验证码和账号安全由你本人处理。

问题、建议或想加自己的筛选条件：[GitHub Issues](https://github.com/huntingrin/xhs-opportunity-kit/issues)。

MIT License.
