# 本地数据库准备

本项目本地开发建议准备两个 PostgreSQL 数据库：

```text
DATABASE_URL       # 本地开发长期保留库
TEST_DATABASE_URL  # Harness 专用测试库，可 reset / seed / cleanup
```

这两个库必须彼此独立。`DATABASE_URL` 用于日常开发、手动调试和 Prisma migrate；`TEST_DATABASE_URL` 只给 Harness、自动化测试或端到端测试使用，允许在测试流程中清空、重建、seed 或 cleanup。

## 为什么 Harness 不能 fallback 到 DATABASE_URL

Harness 可能执行 reset、seed、cleanup、事务回滚以外的数据清理，甚至在后续测试中运行破坏性初始化步骤。

如果 `TEST_DATABASE_URL` 缺失时自动 fallback 到 `DATABASE_URL`，测试流程就可能误删或污染开发库中的长期数据。因此规则必须是：

```text
TEST_DATABASE_URL 缺失 -> Harness 启动失败
TEST_DATABASE_URL === DATABASE_URL -> Harness 启动失败
```

不要在 Harness 里做任何“贴心 fallback”。失败比误删开发数据安全得多。

## 手动创建数据库

以下命令适用于 Windows、WSL 和 macOS。只要能访问本机 PostgreSQL，并且当前用户有建库权限即可。

进入 PostgreSQL 命令行：

```bash
psql -U postgres
```

创建两个本地数据库：

```sql
CREATE DATABASE ai_chat_assistant_dev;
CREATE DATABASE ai_chat_assistant_test;
```

退出：

```sql
\q
```

如果你使用 pgAdmin、TablePlus、DataGrip 或 Docker PostgreSQL，也可以在图形界面中创建同名数据库。

不要在本教程中 drop 开发库。开发库是长期保留库，测试清理只能作用于 `TEST_DATABASE_URL` 指向的库。

## .env 示例

`.env` 用于本机开发，不应提交到 Git：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_chat_assistant_dev?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_chat_assistant_test?schema=public"
NUXT_PUBLIC_APP_NAME="AIChatAssistant"
AI_CHAT_PROVIDER=mock
```

`.env.example` 可以保留同样的变量名和示例值，供新开发者复制：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_chat_assistant_dev?schema=public"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_chat_assistant_test?schema=public"
NUXT_PUBLIC_APP_NAME="AIChatAssistant"
AI_CHAT_PROVIDER=mock
```

如果你的 PostgreSQL 用户、密码、端口不同，只修改连接串对应部分即可。

## Prisma 开发库流程

Prisma migrate 和 generate 默认读取 `DATABASE_URL`。日常开发时让它指向开发库：

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

含义：

* `pnpm exec prisma migrate dev`：面向开发库，用于日常开发、更新数据库结构并生成 migration。
* `pnpm exec prisma generate`：根据 `prisma/schema.prisma` 生成 Prisma Client，不会清空数据库。

不要把 `.env` 中的 `DATABASE_URL` 改成测试库，避免迁移和测试清理混在一起。

## 测试库 migration 验证

测试库或 CI 更适合使用 `migrate deploy`，它只应用已有 migration，不负责生成新的 migration。

验证测试库 migration 时，应临时把子进程的 `DATABASE_URL` 覆盖为 `TEST_DATABASE_URL`。

macOS / Linux / WSL：

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma migrate deploy
```

PowerShell：

```powershell
$env:DATABASE_URL=$env:TEST_DATABASE_URL
pnpm exec prisma migrate deploy
```

以上覆盖只应作用于当前 shell 或子进程，不要写回 `.env`。

## Harness 使用测试库

Harness 运行时应读取 `TEST_DATABASE_URL`，并通过子进程环境变量临时覆盖 `DATABASE_URL`：

```ts
const testDatabaseUrl = process.env.TEST_DATABASE_URL
const devDatabaseUrl = process.env.DATABASE_URL

if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required')
}

if (testDatabaseUrl === devDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL')
}

spawn('pnpm', ['test'], {
  env: {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
  },
})
```

这样测试进程内部仍然可以使用现有 Prisma 配置读取 `DATABASE_URL`，但它实际连接的是测试库。覆盖只存在于 Harness 启动的子进程中，不应写回 `.env`。

## 常见风险

* 连错数据库：先确认连接串中的 host、port、database name。
* 把测试 reset / seed / cleanup 跑到开发库：Harness 必须拒绝缺失或相同的测试库连接串。
* 脚本改写 `.env`：测试覆盖应通过子进程 env 完成，不应修改本地 `.env`。
* Windows / WSL 使用了不同 PostgreSQL 实例：`localhost:5432` 在 Windows 和 WSL 中可能不是同一个服务。
* 数据库密码包含特殊字符：连接串里的密码需要 URL encode。
* 只用同一个 database 的不同 schema 区分开发库和测试库不推荐，容易被 reset / cleanup 误伤。

## 安全检查清单

运行 Harness 前确认：

* `DATABASE_URL` 指向 `ai_chat_assistant_dev` 或你的开发库。
* `TEST_DATABASE_URL` 指向独立测试库。
* `TEST_DATABASE_URL` 不为空。
* `TEST_DATABASE_URL` 不等于 `DATABASE_URL`。
* 任何 reset、seed、cleanup 只作用于测试库。
