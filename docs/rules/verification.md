# 验证与 Harness 规则

## 目标

开发验证必须服务于最终 Harness 验收，不要在最后重新设计一套验收流程。

验证规则需要同时满足：

* 日常开发能快速确认当前改动闭环。
* 每个小版本的稳定验证步骤能沉淀为可复用 scenario 或 E2E spec。
* 最终 `verify:mvp` 能复用前面沉淀的流程、工具、断言和关键场景，而不是另起一套验收实现。

## 默认节奏

* 按 `docs/progress-guideline.md` 的 V0-V9 小版本推进，每次只验证当前任务涉及的最小闭环。
* 每个版本先用人工步骤确认行为，再把稳定的关键步骤沉淀成可复用 Harness scenario 或 E2E spec。
* 新增验证脚本时，优先复用既有 `tests/harness/utils/` 中的 api-client、stream-client、db-assert、wait、test-data 等工具，不要为每个场景复制 fetch、stream 解析或数据库断言逻辑。
* V2 以后涉及流式响应的验证必须复用统一 stream client，能够收集 `message_created`、`text_delta`、`tool_call_created`、`tool_call_updated`、`message_done`、`message_failed`，并支持超时和失败时输出原始片段。
* 涉及数据库断言时，应同时验证 API 行为和数据库状态，尤其是 soft delete、message status、seq、ToolCall status、retry 是否创建新消息、旧消息是否保留。

## `verify:mvp` 规则

* 最终 `verify:mvp` 应复用 V1-V8 已沉淀的流程、工具、断言和关键场景，但不要求机械顺序执行 `verify:v1` 到 `verify:v5` 或所有历史命令。
* `verify:mvp` 可以组织为更高层的完整 MVP flow，只要它复用了前面积累的 api-client、stream-client、db-assert、测试数据和关键断言，且覆盖最终验收所需行为即可。
* 不要为了“复用”而重复跑低价值、重复初始化或互相冲突的历史场景。
* 不要在 V9 另起一套与前面验证逻辑无关的全新验收实现。

## Harness 数据库要求

* Harness 必须使用测试数据库，读取 `TEST_DATABASE_URL`。
* 不允许 Harness fallback 到 `DATABASE_URL`。
* 如果没有配置 `TEST_DATABASE_URL`，Harness 必须直接失败。
* Harness 不修改 `.env`。
* 需要连接测试库时，只能在测试子进程环境变量中临时将 `DATABASE_URL` 覆盖为 `TEST_DATABASE_URL`。
* reset / seed / cleanup 只能作用于测试数据库，不允许删除开发库或线上库数据。
* 涉及 reset test db、migration、seed 的脚本必须把目标数据库来源写清楚，避免误操作。
* 默认使用温和 reset：按外键依赖顺序清空业务表、重置必要序列或使用事务隔离测试数据，不默认 drop schema / drop database。
* `prisma migrate reset` 破坏性更强，除非明确确认，否则 Harness 不应默认使用。

## 验证命令选择

完成代码修改后，根据改动范围尽量运行相关命令，而不是机械跑全部命令。

常见命令：

```bash
pnpm verify:base
pnpm verify:v1
pnpm verify:v2
pnpm verify:v3
pnpm verify:v4
pnpm verify:v5
pnpm e2e:ui
pnpm e2e:markdown
pnpm verify:mvp
pnpm lint
pnpm typecheck
pnpm test
```

当前阶段命令可能尚未全部存在。若命令不存在、依赖未安装、服务未启动、数据库未配置或无法运行，需要明确说明原因；不要声称已测试但实际没有运行。

## 最终回复要求

最终回复中必须说明：

* 实际运行了哪些验证命令。
* 哪些命令没有运行以及原因。
* 本次新增或修改的人工验证步骤是否已经沉淀为可复用 Harness scenario / E2E spec；如果还没有，需要说明后续应沉淀到哪个文件或命令。
* 本次验证是否满足 `docs/progress-guideline.md` 中对应小版本的要求。
