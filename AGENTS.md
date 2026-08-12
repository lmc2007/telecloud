# AGENTS.md — AI 开发流程

## 修改前必读

- `DEVDOC.md`：架构、API 路由表、存储设计
- `worker/src/types/index.ts`：后端全部类型
- `frontend/src/stores/fileStore.ts`：前端 FileItem 类型

## 修改后必跑

```bash
# 后端：改了 worker/src/ 下任何文件都要跑
cd worker && npx esbuild src/index.ts --bundle --format=esm --target=es2022 --outfile=dist/worker.js --platform=browser --external:cloudflare:workers

# 前端：改了 frontend/src/ 下任何文件都要跑
cd frontend && npm run build   # tsc --noEmit && vite build
```

两边都通过才算改完。

## 修改后

**修改代码后，必须在回复末尾询问用户是否推送到 GitHub，不得擅自推送。**

## 前端改动影响面

| 改了 | 可能影响 |
|------|---------|
| `api.ts` | 所有页面和组件的 API 调用 |
| `stores/*.ts` | 所有使用该 store 的组件 |
| `FileItem` 类型 | FileTable、FileGrid、FileIcon、ContextMenu、PreviewModal、ShareAccessPage |
| `globals.css` | 全局样式 |
| `ShareAccessPage` | 分享页桌面端 + 移动端（双轨渲染，两端都要改） |
| `FileManager` | `/app` 桌面端 + 移动端（两端都要改） |

## 后端改动影响面

| 改了 | 可能影响 |
|------|---------|
| `types/index.ts` | 全局类型，前端可能也有对应接口 |
| `routes/shares.ts` | 分享创建/访问/下载全链路 |
| `routes/files.ts` | 文件 CRUD + 回收站 + 搜索 |
| `storage/kv.ts` | 所有 route 和 handler 的持久化 |
| `handlers/upload.ts` | 上传会话 + WS 上传 |
| `handlers/download.ts` | 流式下载 + chunk/Range 处理 |
| `index.ts` | `handleUploadComplete`、WS 路由、自定义 HTTP handler |

## 常见陷阱

1. **前端 `FileItem.type`** 是 `"file" | "folder"`，新增属性要同步 `toFileItem()` 适配器（ShareAccessPage 用）
2. **分享页双轨**：ShareAccessPage 有 `isMobile` 分支，改桌面端也要改移动端
3. **文件夹分享**：D1 `file_id` 列存 JSON 数组 `["uuid"]`，解析要 `JSON.parse` + 检测 KV `target_type`
4. **D1 同步**：`setFileMeta`/`setFolderMeta` 内部 await 同步 D1，不要在外面再写一遍
5. **KV key 格式**：`file:{id}` / `folder:{id}` / `child:{parent}:{child}` / `share:{token}` / `user_root:{userId}`
6. **路由顺序**：`DELETE /files/trash` 必须在 `DELETE /files/:id` 前注册
7. **upload/complete**：`file_ids` 需要 `index` 字段排序，前端 wsVol 中的 `r.ids` 已按 index 排序
8. **敏感信息**：域名、KV/D1 ID 不要硬编码，用 `.env` / `wrangler.jsonc`（都在 `.gitignore` 中）

## 新增功能 checklist

1. 后端类型定义 (`types/index.ts`)
2. 后端路由/逻辑
3. 前端类型适配（如果需要）
4. 前端 UI（桌面 + 移动双轨）
5. 构建验证（worker + frontend 都通过）
6. 更新 `DEVDOC.md`（API 路由表、架构说明）
7. 更新 `README.md`（如果是用户可见功能）
8. **询问用户是否推送到 GitHub**（不要擅自推送）

<!-- >>> aimax:reasonix >>> -->
# AI MAX Reasonix 集成
本项目的 AI MAX 工作流已适配 Reasonix。Reasonix 是模型无关的宿主，模型由 `reasonix.toml` 或 `--model` 选择；不要在项目文件中写入 API key。

## 使用边界
- Reasonix 会自动读取本文件；需要专门工作流时，从 `.agents/skills/aimax-*` 中选择对应技能。
- 不得输出或调用 Claude Code 的 `/aimax:*` 斜杠命令；应直接使用 `aimax-command-*` 技能。
- 使用 `aimax-command-auto` 时，选中目标命令后必须读取对应的 `.agents/skills/aimax-command-<命令名>/SKILL.md`，并在当前轮执行完整流程，不得只报告路由结果。
- 执行任何 Git 命令前必须先确认当前项目或其父目录存在 `.git`；如果不存在，跳过所有 Git 命令并继续非 Git 工作流，不得将其视为失败。
- AI MAX 的 agent 和 command 已转换为 Reasonix 技能，原始副本保存在 `.aimax/reasonix` 供审阅。
- 下方只内嵌宿主无关的通用规则；Claude 专属的 agent 和 hook 配置不会注入 Reasonix。

### AI MAX 规则: coding-style.md

# 编码风格

## 不可变性（关键）

始终创建新对象，绝不修改原对象：

```javascript
// 错误: 可变操作
function updateUser(user, name) {
  user.name = name  // 可变操作！
  return user
}

// 正确: 不可变操作
function updateUser(user, name) {
  return {
    ...user,
    name
  }
}
```

## 文件组织

多个小文件 > 少量大文件：
- 高内聚，低耦合
- 通常 200-400 行，最多 800 行
- 从大型组件中提取工具函数
- 按功能/领域组织，而非按类型组织

## 错误处理

始终全面处理错误：

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('Detailed user-friendly message')
}
```

## 输入验证

始终验证用户输入：

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

const validated = schema.parse(input)
```

## 代码质量检查清单

在标记工作完成前：
- [ ] 代码可读性好且命名规范
- [ ] 函数简短（<50 行）
- [ ] 文件聚焦（<800 行）
- [ ] 无深层嵌套（>4 层）
- [ ] 正确的错误处理
- [ ] 无 console.log 语句
- [ ] 无硬编码值
- [ ] 无可变操作（使用不可变模式）


### AI MAX 规则: git-workflow.md

# Git 工作流

## 提交信息格式

```
<type>: <description>

<optional body>
```

类型: feat, fix, refactor, docs, test, chore, perf, ci

## Pull Request 工作流

创建 PR 时：
1. 分析完整的提交历史（不仅仅是最新的提交）
2. 使用 `git diff [base-branch]...HEAD` 查看所有变更
3. 撰写全面的 PR 摘要
4. 包含带 TODO 的测试计划
5. 如果是新分支，推送时使用 `-u` 标志

## 功能实现工作流

1. **先规划**
   - 使用 **planner** agent 创建实现计划
   - 识别依赖和风险
   - 分解为多个阶段

2. **TDD 方法**
   - 使用 **tdd-guide** agent
   - 先编写测试（红灯）
   - 实现代码使测试通过（绿灯）
   - 重构（改进）
   - 验证 80%+ 覆盖率

3. **代码审查**
   - 编写代码后立即使用 **code-reviewer** agent
   - 解决关键和高优先级问题
   - 尽可能修复中等优先级问题

4. **提交和推送**
   - 详细的提交信息
   - 遵循约定式提交格式

## 输出规则
- 只输出提交信息本身，不要添加任何签名、标记或元信息
- 不要包含 "Generated with Claude Code"、"Co-Authored-By" 等署名内容
- 不要使用 emoji 表情符号
- 保持简洁专业的风格


### AI MAX 规则: patterns.md

# 常用模式

## API 响应格式

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}
```

## 自定义 Hook 模式

```typescript
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}
```

## 仓储模式（Repository Pattern）

```typescript
interface Repository<T> {
  findAll(filters?: Filters): Promise<T[]>
  findById(id: string): Promise<T | null>
  create(data: CreateDto): Promise<T>
  update(id: string, data: UpdateDto): Promise<T>
  delete(id: string): Promise<void>
}
```

## 骨架项目

实现新功能时：
1. 搜索经过实战检验的骨架项目
2. 使用并行 agent 评估选项：
   - 安全评估
   - 可扩展性分析
   - 相关性评分
   - 实现规划
3. 克隆最佳匹配作为基础
4. 在经过验证的结构中迭代


### AI MAX 规则: performance.md

# 性能优化

## 模型选择策略

**Haiku 4.5**（Sonnet 90% 能力，节省 3 倍成本）：
- 频繁调用的轻量级 agent
- 结对编程和代码生成
- 多 agent 系统中的工作 agent

**Sonnet 4.5**（最佳编码模型）：
- 主要开发工作
- 编排多 agent 工作流
- 复杂编码任务

**Opus 4.5**（最深度推理）：
- 复杂架构决策
- 最高推理需求
- 研究和分析任务

## 上下文窗口管理

在上下文窗口的最后 20% 避免：
- 大规模重构
- 跨多文件的功能实现
- 调试复杂交互

对上下文敏感度较低的任务：
- 单文件编辑
- 独立工具函数创建
- 文档更新
- 简单 Bug 修复

## Ultrathink + Plan 模式

对于需要深度推理的复杂任务：
1. 使用 `ultrathink` 增强思考
2. 启用 **Plan 模式** 进行结构化方法
3. 通过多轮批评"预热引擎"
4. 使用分角色子 agent 进行多样化分析

## 构建故障排除

如果构建失败：
1. 使用 **build-error-resolver** agent
2. 分析错误信息
3. 增量修复
4. 每次修复后验证


### AI MAX 规则: security.md

# 安全指南

## 强制安全检查

每次提交前：
- [ ] 无硬编码密钥（API 密钥、密码、令牌）
- [ ] 所有用户输入已验证
- [ ] SQL 注入防护（参数化查询）
- [ ] XSS 防护（HTML 净化）
- [ ] CSRF 保护已启用
- [ ] 身份验证/授权已验证
- [ ] 所有端点已启用速率限制
- [ ] 错误信息不泄露敏感数据

## 密钥管理

```typescript
// 绝不: 硬编码密钥
const apiKey = "sk-proj-xxxxx"

// 始终: 使用环境变量
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## 安全响应协议

如果发现安全问题：
1. 立即停止
2. 使用 **security-reviewer** agent
3. 继续之前修复关键问题
4. 轮换任何泄露的密钥
5. 审查整个代码库是否存在类似问题


### AI MAX 规则: testing.md

# 测试要求

## 最低测试覆盖率：80%

测试类型（全部必需）：
1. **单元测试** - 单个函数、工具函数、组件
2. **集成测试** - API 端点、数据库操作
3. **E2E 测试** - 关键用户流程（Playwright）

## 测试驱动开发

强制工作流：
1. 先编写测试（红灯）
2. 运行测试 - 应该失败
3. 编写最小实现（绿灯）
4. 运行测试 - 应该通过
5. 重构（改进）
6. 验证覆盖率（80%+）

## 测试失败故障排除

1. 使用 **tdd-guide** agent
2. 检查测试隔离性
3. 验证 mock 是否正确
4. 修复实现，而非测试（除非测试有误）

## Agent 支持

- **tdd-guide** - 主动用于新功能，强制先写测试
- **e2e-runner** - Playwright E2E 测试专家


## Reasonix 模型配置
本机可使用 `reasonix --model deepseek/deepseek-v4-flash` 或在 Reasonix 全局配置中设置 `default_model`。模型接入和凭据由 Reasonix 管理，AI MAX 不复制或修改凭据。
<!-- <<< aimax:reasonix <<< -->
