# AIChatAssistant

AIChatAssistant 是一个基于 Nuxt + TypeScript + Vite 的 AI Chat 应用底座。第一阶段目标是跑通流式聊天、停止生成、失败重试、基础工具调用、会话存储和 Assistant Profile 扩展口子。

当前项目保持通用 AI Chat 定位，不绑定具体垂直业务。

## 技术栈

- Nuxt
- Vue 3
- TypeScript
- Vite
- Prisma
- PostgreSQL

## 本地启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

开发服务默认地址：

```text
http://localhost:3000
```

### 1. 启动数据库

```powershell
$env:PG_BIN = "E:\software\postgreSQL\postgresql-18.3-3-windows-x64-binaries\pgsql\bin"
$env:PG_DATA = "E:\software\postgreSQL\postgresql-18.3-3-windows-x64-binaries\pgsql\data"

& "$env:PG_BIN\pg_ctl.exe" -D "$env:PG_DATA" -l "$env:PG_DATA\postgresql.log" start
& "$env:PG_BIN\pg_isready.exe" -h 127.0.0.1 -p 5432
```

## 目录结构

```text
app/
  components/chat/      # 聊天页面组件
  composables/          # 前端状态和请求逻辑
  pages/                # Nuxt 页面
  types/                # 前端 DTO 和运行时类型
server/
  api/                  # Nuxt server routes
  profiles/             # Assistant Profile 代码配置
  tools/                # Tool Registry
prisma/
  schema.prisma         # 数据库结构真实来源
docs/
  rules/                # 前后端和聊天状态规则
```

## 当前进度

- 已生成 Nuxt 基础项目配置。
- 已创建聊天页面组件骨架。
- 已创建 Profile 只读接口：`GET /api/profiles`。
- 已创建 Tool Registry 只读接口：`GET /api/tools`。
- 已保留 Prisma 数据模型。

下一步建议优先实现 `POST /api/conversations`、`GET /api/conversations` 和 mock stream 版 `POST /api/chat`。
