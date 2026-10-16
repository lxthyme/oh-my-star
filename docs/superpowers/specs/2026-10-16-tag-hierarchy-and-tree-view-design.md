# 标签层级嵌套与层级树视图 — 设计文档

- 日期：2026-10-16
- 状态：已实现（2026-10-16）
- 迁移：`drizzle/0002_*.sql` 已生成，生产库需执行 `npm run db:migrate`
- 取代：`2026-10-16-tag-relation-graph-design.md`（共现关系图方案，本方案确认后作废删除）

## 背景

`/tags` 页是 `TagManager` 的单张 `Table` + 搜索 + 分页，标签一多就退化成一页页翻的平铺列表。上一版考虑用"共现关系"派生关联，但共现只反映统计上的亲疏，表达不了用户心里的分类结构，且标签越多图越像毛球。

本次改为**显式的标签层级**：标签支持父级嵌套，已有标签默认都是 1 级；并新增独立页面用 ECharts 树图展示层级关系与各标签的 repo 数量，支持折叠/展开。

## 可行性验证结论（已在本机实测）

| 验证项 | 结论 |
|---|---|
| ECharts 6.1.0 是否提供树图 | ✅ `echarts/charts` 导出 `TreeChart`（`lib/export/charts.js`：`export { install as TreeChart } from '../chart/tree/install.js'`） |
| 折叠/展开 | ✅ `TreeSeries` 默认 `expandAndCollapse: true`、`initialTreeDepth: 2`、`edgeShape: 'curve'`；`roam` 默认 `false`，可开启 |
| 已有表新增自引用列 | ✅ libsql 上 `ALTER TABLE tags ADD COLUMN parent_id integer REFERENCES tags(id)` 执行成功，原有数据保留 |
| 外键约束 | ✅ 默认生效：插入不存在的 `parent_id` 报 `FOREIGN KEY constraint failed` |
| 成环 | ⚠️ 数据库**不拦截**（`UPDATE tags SET parent_id=2 WHERE id=1` 成功），必须应用层拦截 |
| 递归 CTE | ✅ 子树、祖先链均可用；⚠️ **必须带 depth 上限**——实测人为造环后无上限的 CTE 会无限递归直到进程 OOM，加上限后毫秒级终止 |
| 删除父标签 | ⚠️ 外键开启时直接删除会被拒，必须先处理子标签 |
| drizzle 自引用外键类型 | ✅ `AnySQLiteColumn` 可用（`drizzle-orm/sqlite-core/columns/common.d.ts`） |

**结论：方案可行。** 风险集中在"层级变更的一致性"，用应用层校验 + 事务 + depth 上限兜住。

## 性能实测（深度上限 3 vs 5）

构造数据：**363 个标签（3 / 9 / 27 / 81 / 243 五层）、3000 个 repo、6000 条 `repo_tags`**，libsql 本地文件库，每项跑 5 次取均值：

| 查询 | depth < 3 | depth < 5 | 说明 |
|---|---|---|---|
| 全量标签 + repoCount（`/api/tags` 主查询） | — | **70.7 ms** | 与深度无关，取决于标签数与 `repo_tags` 行数；这是**当前已存在**的开销，层级不新增成本 |
| 子树 CTE（从一级标签展开） | 0.23 ms（40 行） | **0.26 ms**（121 行） | 差 0.03 ms，可忽略 |
| 祖先链 CTE（从 5 级节点向上） | — | **0.04 ms**（5 行） | 防环校验成本可忽略 |
| 按子树筛选仓库 count | — | **34.7 ms** | 成本来自 `EXISTS + IN(子树 id)` 扫描 `repo_tags`，与子树规模相关 |
| 成环兜底（人为造环） | 44 行后终止 | 165 行后终止 | 均有界，毫秒级 |

顺带实测：给 `repo_tags` 加 `(user_id, tag_id)` 索引对上述两个查询**没有明显提升**（70.7 → 74.0 ms、34.7 → 34.3 ms），因为现有主键 `(user_id, repo_id, tag_id)` 已覆盖按 repo 查的场景，而按 tag 统计是全表聚合。**结论：不为层级需求新增索引**，避免无谓的迁移风险（数据量再上一个量级时可重新评估）。

**深度 3 → 5 的结论：性能影响可以忽略**（算法复杂度不变，实测差异在 0.03 ms 量级）。真正的代价在**可读性**：LR 布局下 5 层更宽、`path` 文本更长、父级下拉要排除的子孙更多。因此 `TAG_MAX_DEPTH` 定为 **5**，靠折叠、`roam` 缩放、`LR/TB` 切换来缓解拥挤。

## 需求范围

### A. 数据模型与 CRUD

1. `tags` 增加 `parentId`（可空、自引用外键），`NULL` = 顶级（1 级）。
2. 迁移：`npm run db:generate` 生成 `drizzle/0001_*.sql` 并提交；已有标签 `parent_id` 全为 `NULL`，天然就是 1 级，**无需数据回填**。
3. 层级深度上限：`TAG_MAX_DEPTH = 5`（集中在 `lib/tag-limits.ts`，实测性能无压力）。
4. 变更父级时的校验：
   - 父级必须存在且属于同一用户；
   - 不能是自己；
   - 不能是自己的子孙（祖先链 CTE 校验）；
   - 移动后整棵子树的最大深度不得超过 `TAG_MAX_DEPTH`。
5. `createTag` 支持指定 `parentId`（不指定 = 顶级）；`updateTag` 支持修改层级（含移到顶级）。
6. **`deleteTag`：若存在子标签，同一事务内把直接子标签移到专用标签「已删除待处理」下**，再删除标签本身（详见下文"专用标签"）。
7. 接口：`GET /api/tags` 返回 `parentId`、`path`（如"工具 / CLI"）、`depth`、`childrenCount`；`POST`、`PATCH` 支持 `parentId`（`null` = 顶级）；`DELETE` 返回 `{ ok, movedChildren }`。
8. **仓库筛选语义**：筛选栏选中父标签时，匹配其**整棵子树**的 repo（详见下文"子树匹配语义"）。
9. 筛选栏标签下拉按层级缩进展示，显示完整路径。

### B. 层级树可视化（独立页面）

1. 新增**独立页面 `/tags/tree`**（路由 `app/tags/tree/page.tsx`），不使用 Modal。
   - 入口：`/tags` 页顶部「层级图」按钮（`Link` 跳转）；页面内提供返回按钮。
   - 暂不在 `AppShell` 顶部导航增加入口，避免菜单膨胀（需要时可加）。
2. 页面布局（空间比 Modal 充裕）：顶部控件行 + 左侧 ECharts `tree`（撑满剩余高度）+ 右侧常驻详情面板。
3. 多个顶级标签需要单一 root → 引入**虚拟根节点「全部标签」**（value = 所有标签 repo 数之和，只用于布局，不可选中/跳转）。
4. 节点：`symbolSize` ∝ `repoCount`；label 显示 `名称 (repoCount)`；tooltip 显示完整 path、描述、自身 repo 数、**含子级合计**、子标签数。
5. **折叠**：`expandAndCollapse: true`；提供"展开全部 / 收起 / 默认 2 层"三档（`initialTreeDepth` 分别 `-1` / `1` / `2`）；点击节点本身即可折叠展开。
6. `roam: true`（缩放 + 平移）、`orient` 可切 `LR` / `TB`、`edgeShape: 'curve'`。
7. 点击非根节点 → 右侧详情面板显示名称、path、描述、自身/含子级 repo 数、子标签列表，并提供「查看该标签仓库」「查看含子级仓库」按钮，跳 `/repos?tag=<id>`（子树匹配）。
8. **搜索定位**：输入标签名，自动展开到该节点的祖先链并高亮（`dispatchAction({ type: 'highlight' })` / 重建 option 并展开路径）。
9. 空态（无标签）、加载态、以及"全部都是 1 级"时的说明文案。
10. 颜色全部取自 antd `theme.useToken()`，明暗主题均可读，不写死颜色。

## 关键语义设计

### 子树匹配语义（对应"选中父标签是否包含子孙 repo"）

受影响的**三个位置**，统一采用"**默认包含子孙**"：

| 位置 | 现状 | 层级化后 |
|---|---|---|
| 仓库列表筛选（`/repos`、`/stars` 的筛选栏「标签」下拉） | `?tag=X` → `/api/repos?tagId=X` → `buildWhere` 中 `EXISTS (... tag_id = X)` | 展开为子树 id 集合，`tag_id IN (子树)`：选「语言」也会筛出打了「语言 / Go」的 repo |
| 筛选栏下拉里每个标签后的数量（上一版刚加） | 直接打标数 | 显示**含子级合计**（tooltip 里区分自身 / 含子级） |
| `TagManager` 表格「仓库数」列 | 直接打标数 | 主列显示**含子级合计**，tooltip/副文本给出自身数量 |

理由：若只算直接打标，选中父标签后返回的结果会明显少于下拉里显示的数字，非常反直觉。

### 专用标签「已删除待处理」

- 名称常量 `ORPHAN_TAG_NAME = "已删除待处理"`（放在 `lib/tag-limits.ts` 旁或 `lib/db/tags.ts` 内）。
- **语义边界**：这个标签**只**承接"父标签被删除后遗留的子标签"，表示"待你重新安排归属"，**不**用于一般意义上的"未分类 / 未归类"，两者不混用。
- **触发时机**：只有在删除一个有子标签的标签时，才把它**直接子标签** reparent 到「已删除待处理」下，再删除该标签；整个过程在同一事务内。除此之外不自动创建、不自动挂任何标签。
- **「已删除待处理」本身是普通标签**：复用现有 `userId + name` 唯一约束与 `createTag` 的幂等语义，不存在时自动创建、已存在则复用，不会重复创建；用户可随时改名、改父级、删除（满足"后续可以手动调整"）。
  - 不引入 `isSystem` 字段，避免 schema 与逻辑复杂度。
  - 不做特殊着色，避免"系统内置"错觉。
- **删除「已删除待处理」自己时**：其子标签**提升为顶级**（而不是再创建一个新的「已删除待处理」，否则会递归）。
- **确认文案**：删除弹窗明示「N 个子标签将移动到「已删除待处理」下」。

## 实现设计

### 1. Schema 与迁移 `lib/db/schema.ts`

```ts
import { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

export const tags = sqliteTable(
  "tags",
  {
    // ...既有字段
    parentId: integer("parent_id").references((): AnySQLiteColumn => tags.id),
  },
  (table) => [unique().on(table.userId, table.name)],
)
```

- 迁移 SQL 由 `npm run db:generate` 生成，落在 `drizzle/0001_*.sql`，随代码提交。
- 生产库（Turso）需在部署流程中执行 `npm run db:migrate`；先在测试库验证一次。
- **不新增索引**（实测无收益）。

### 2. 数据层 `lib/db/tags.ts`

- `listTags`：返回增加 `parentId`、`depth`、`childrenCount`、`path`、自身 `repoCount` 与含子级 `totalRepoCount`。path/层级信息在内存中构建（一次查全量后按 `parentId` 组装，标签量级小）。
- 新增 `listTagSubtreeIds(db, userId, tagId)`：递归 CTE 求子树 id 集合，**带 `depth < TAG_MAX_DEPTH` 上限**。
- 新增 `listTagAncestorIds(db, userId, tagId)`：祖先链 CTE（同样带上限），用于改父级时防环。
- `createTag(db, userId, name, description?, parentId?)`：校验父级后写入。
- `updateTag` 的 `TagUpdateInput` 增加 `parentId?: number | null`：
  - `undefined` = 不修改（保持现有 PATCH 语义）；
  - `null` = 移到顶级；
  - 数字 = 指定父级。
- `deleteTag(db, userId, tagId)`：事务内 ① 取直接子标签 → ② 有则确保「已删除待处理」存在并把子标签 reparent 过去 → ③ 删 `repo_tags` → ④ 删标签；返回被移动的子标签数量。
- 深度校验：新父级 `depth + 子树高度 ≤ TAG_MAX_DEPTH`（子树高度由子树 CTE 求 max depth）。
- `getOrCreateOrphanTag(db, userId)`：内部辅助，复用 `createTag` 的幂等语义。

### 3. 仓库筛选 `lib/db/repos.ts`

- `buildWhere` 中 `tagId` 命中时，先展开为子树 id 集合，改为 `EXISTS (... AND tag_id IN (...))`。
- `"untagged"` 语义不变（没有任何标签的仓库）。

### 4. 接口

- `GET /api/tags`：扩展返回字段（见 A7），其余不变。
- `POST /api/tags`：body 增加 `parentId`（可空）。
- `PATCH /api/tags/[id]`：body 支持 `parentId`（`null` = 顶级）。
- `DELETE /api/tags/[id]`：返回 `{ ok: true, movedChildren: n }`。
- **不新增** `/api/tags/relations`（上一版方案废弃）。

### 5. 前端

- `app/tags/tree/page.tsx`（新增）：`Suspense` 包裹 `TagTreePage`，与现有 `app/tags/page.tsx` 写法一致。
- `app/components/TagManager.tsx`（修改）：
  - 表格新增"层级"列（path 面包屑样式）与"子标签数"列；「仓库数」列显示含子级合计。
  - 新建/编辑弹窗新增"父级" `Select`：选项按层级缩进，排除自身与其所有子孙。
  - 顶部新增「层级图」按钮，跳转 `/tags/tree`。
  - 删除确认文案改为"N 个子标签将移动到「已删除待处理」下"。
- `app/components/FilterBar.tsx`（修改）：标签下拉按层级缩进 + 显示完整路径，数量改为含子级合计（复用现有 `optionRender` 机制，搜索仍按 label 过滤）。
- `app/components/TagTreeChart.tsx`（新增，client component）：
  - 按需引入 `echarts/core` + `TreeChart` + `TooltipComponent` + `CanvasRenderer`。
  - props：`tags`、`selectedId`、`onSelect`、`depthMode`、`orient`、`height`。
  - 内部构建虚拟 root 后 `setOption`；`ResizeObserver` 触发 `resize()`；卸载 `dispose()`。
  - `chart.on('click')` 命中节点时回调 `onSelect`。
- `app/components/TagTreePage.tsx`（新增）：页面骨架 = 控件行（展开档位、orient、搜索定位）+ 图 + 右侧详情面板 + 返回按钮。
- 图表组件用 `dynamic(..., { ssr: false })` 引入，仅进入层级图页面时加载 ECharts。

### 6. 依赖

- `npm i echarts`（6.1.0），按需引入 `TreeChart`；动态加载，标签管理页首屏不受影响。

## 影响范围

- 修改：`lib/db/schema.ts`、`lib/db/tags.ts`、`lib/db/repos.ts`、`app/api/tags/route.ts`、`app/api/tags/[id]/route.ts`、`app/components/TagManager.tsx`、`app/components/FilterBar.tsx`、`lib/tag-limits.ts`、`lib/db/tags.test.ts`（+ 可能 `lib/db/repos.test.ts`）、`package.json`。
- 新增：`drizzle/0001_*.sql` + `drizzle/meta/*`、`app/tags/tree/page.tsx`、`app/components/TagTreePage.tsx`、`app/components/TagTreeChart.tsx`。
- 不动：repo 的同步逻辑、`RepoCard` / `TagSelect` 的打标交互、现有"未打标"筛选语义、全局样式、`AppShell` 导航。

## 验收与验证

- 单测（`lib/db/tags.test.ts` 扩充）：
  - 新建标签默认 `parentId` 为 `NULL`；指定父级后 `depth` / `path` 正确。
  - 修改父级生效；移到顶级（`parentId = null`）生效。
  - 拒绝自引用、拒绝把父级设为子孙（防环）。
  - 超过 `TAG_MAX_DEPTH` 时拒绝。
  - 删除有子标签的标签后，子标签被移到「已删除待处理」下；删除「已删除待处理」时其子标签提升为顶级。
  - `listTagSubtreeIds` 多层展开正确；仓库筛选按子树匹配。
- 手动验证：
  - `/tags` → 「层级图」进入独立页面，树正确渲染；展开/折叠、全部展开、收起正常。
  - 点击节点右侧详情正确，跳转 `/repos?tag=<id>` 后筛选栏选中且结果含子标签仓库。
  - 搜索定位能展开祖先链并高亮；`LR` / `TB` 切换正常；明暗主题下可读。
  - 编辑标签改父级后，`/tags` 表格 path 与层级图同步更新。
  - 删除父标签后子标签出现在「已删除待处理」下，且可再手动改父级。
- 工程检查：`npx tsc --noEmit`（`scripts/` 下既有报错除外）、`npx eslint` 改动文件、`npx vitest run` 无新增失败（`lib/api-error.test.ts` 为改动前已存在的失败）。
- 迁移验证：在空库和含既有标签的库各跑一次 `db:migrate`，确认旧数据 `parent_id` 全为 `NULL` 且页面正常。

## 风险与对策

- **递归 CTE 跑飞**：所有 CTE 一律带 `depth < TAG_MAX_DEPTH` 上限（已实测必要性，无上限会 OOM）。
- **删除父标签被外键拒绝**：事务内先 reparent 子标签再删除。
- **层级过深图拥挤**：`TAG_MAX_DEPTH = 5` + 折叠 + `roam` + `LR/TB` 切换（性能无压力，主要是可读性）。
- **迁移需上生产库**：先在测试库验证，再走现有部署流程执行 `db:migrate`。
- **老数据全是 1 级**：初期层级图是一片扁平，属预期；文案提示"还没有子标签，编辑标签可指定父级"。

## 不在本次范围内

- 共现关系图（上一版方案）。
- 拖拽调整层级（用 Select 选父级即可）。
- 标签合并 / 批量重命名。
- 词云、treemap 等其他可视化。
- 在 `AppShell` 顶部导航增加层级图入口（先只从 `/tags` 页进入）。
