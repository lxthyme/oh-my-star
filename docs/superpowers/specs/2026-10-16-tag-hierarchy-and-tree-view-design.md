# 标签层级嵌套与层级树视图 — 设计文档

- 日期：2026-10-16
- 状态：已实现（2026-10-16）
- 迁移：`drizzle/0002_*.sql`（`parent_id`）与 `drizzle/0003_*.sql`（`role`）已生成，生产库需执行 `npm run db:migrate`
- 取代：`2026-10-16-tag-relation-graph-design.md`（共现关系图方案，本方案确认后作废删除）
- 后续修订：实现后按评审反馈追加了「专用标签按 `role` 识别」「改父级校验与写入同事务」「含子级合计改为 SQL 侧聚合」「`/tags` 换树形表格」「搜索定位只展开祖先链」「失效深链接重置筛选」六项，均已在下文标注 **（修订）**

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
6. **`deleteTag`：若存在子标签，同一事务内把直接子标签移到专用标签「已删除待处理」下**，再删除标签本身（详见下文"专用标签"）。该专用标签本身**禁止删除**。
7. 接口：`GET /api/tags` 返回 `parentId`、`role`、`path`（如"工具 / CLI"）、`depth`、`childrenCount`；`POST`、`PATCH` 支持 `parentId`（`null` = 顶级）；`DELETE` 返回 `{ ok, movedChildren }`。
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

- 名称常量 `ORPHAN_TAG_NAME = "已删除待处理"`（`lib/tag-limits.ts`），**仅用于展示与首次创建时的取名**。
- **语义边界**：这个标签**只**承接"父标签被删除后遗留的子标签"，表示"待你重新安排归属"，**不**用于一般意义上的"未分类 / 未归类"，两者不混用。
- **触发时机**：只有在删除一个有子标签的标签时，才把它**直接子标签** reparent 到「已删除待处理」下，再删除该标签；整个过程在同一事务内。除此之外不自动创建、不自动挂任何标签。
- **身份识别靠 `role`，不靠名称（修订）**：
  - `tags.role` 为可空列，取值 `'orphan' | null`；`NULL` = 普通标签。
  - 理由：按名称判断时"给它改名"会让保护失效，且用户自建的同名标签会被 `getOrCreateOrphanTag` 误认领为落点。`role` 是稳定标识，改名不影响身份。
  - `getOrCreateOrphanTag` 的顺序：① 按 `role = 'orphan'` 查 → ② 查不到再按名称找（兼容 `role` 上线前既有的同名标签，找到就把它升为 `role='orphan'`）→ ③ 都没有才新建（带上 `role` 与默认描述）。
- **该标签是特殊类型，有三条限制（修订）**：
  | 操作 | 是否允许 | 说明 |
  |---|---|---|
  | 删除 | ❌ | 它是遗留子标签的落点，删掉就没人承接；想清理请先把子标签移到其他父级下。数据层抛 `TagHierarchyError`，接口返回 400，UI 上删除按钮置灰 + Tooltip 说明 |
  | 变更层级（改 `parentId`） | ❌ | 编辑弹窗的「父标签」`Select` 置灰，文案改为"专用标签不支持变更层级；可以改名称" |
  | 改名 / 改描述 | ✅ | 名称只是展示，身份由 `role` 决定，改了也不影响任何逻辑 |
  - 不做特殊着色，避免"系统内置"错觉。
  - 因为禁止删除，原"删除专用标签时把子标签提升为顶级"的分支已成为死代码，已移除；但**专用标签被手动挂成某个标签的子标签时，删除其父级不能让它自引用**——这条边界仍在事务内单独处理（提升为顶级），并有测试守住。
- **确认文案**：删除弹窗明示「N 个子标签将移动到「{当前名称}」下」。因为允许改名，文案一律取该标签的当前名称，不写死常量。

## 实现设计

### 1. Schema 与迁移 `lib/db/schema.ts`

```ts
import { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

export const tags = sqliteTable(
  "tags",
  {
    // ...既有字段
    parentId: integer("parent_id").references((): AnySQLiteColumn => tags.id),
    /** 用途标记，NULL 为普通标签；用于按 role 而非名称识别专用标签（修订） */
    role: text("role", { enum: ["orphan"] }),
  },
  (table) => [unique().on(table.userId, table.name)],
)
```

- 迁移 SQL 由 `npm run db:generate` 生成，落在 `drizzle/0002_*.sql`（`parent_id`）与 `drizzle/0003_*.sql`（`role`），随代码提交。
- 生产库（Turso）需在部署流程中执行 `npm run db:migrate`；先在测试库验证一次。
- **不新增索引**（实测无收益）。

### 2. 数据层 `lib/db/tags.ts`

- `listTags`：返回增加 `parentId`、`role`、`depth`、`childrenCount`、`path`、自身 `repoCount` 与含子级 `totalRepoCount`。path/层级信息在内存中构建（一次查全量后按 `parentId` 组装，标签量级小）。
- 新增 `listTagSubtreeIds(db, userId, tagId)`：递归 CTE 求子树 id 集合，**带 `depth < TAG_MAX_DEPTH` 上限**。
- 新增 `listTagAncestorIds(db, userId, tagId)`：祖先链 CTE（同样带上限），用于改父级时防环。
- `createTag(db, userId, name, description?, parentId?)`：校验父级后写入。
- `updateTag` 的 `TagUpdateInput` 增加 `parentId?: number | null`：
  - `undefined` = 不修改（保持现有 PATCH 语义）；
  - `null` = 移到顶级；
  - 数字 = 指定父级。
  - **校验与写入在同一事务内（修订）**：原先"先 `assertValidParent` 再 `.update()`"中间没有事务，两个请求并发互挂父子时两边校验都会通过、然后各自写入形成环（无上限递归 CTE 成环已实测会跑到 OOM）。现在把 `assertValidParent` 与 `update` 一起放进 `db.transaction`，借 SQLite 写事务的串行化消除这个窗口。
    - 为让校验能在事务里跑，几个查询辅助函数的形参类型收窄为 `TagQueryDb = Pick<AppDatabase, "all" | "select">`（`db` 与 `tx` 都满足），不用类型断言。
  - 专用标签（`role === 'orphan'`）传 `parentId` 一律抛 `TagHierarchyError`。
- `deleteTag(db, userId, tagId)`：事务内 ① 取直接子标签 → ② 有则确保「已删除待处理」存在并把子标签 reparent 过去 → ③ 删 `repo_tags` → ④ 删标签；返回被移动的子标签数量。命中 `role === 'orphan'` 时直接抛 `TagHierarchyError`。
  - 专用标签在**事务外**先 `getOrCreateOrphanTag` 准备好：在事务内嵌套创建会与 drizzle 的事务类型冲突。
- 深度校验：新父级 `depth + 子树高度 ≤ TAG_MAX_DEPTH`（子树高度由子树 CTE 求 max depth）。
- `getOrCreateOrphanTag(db, userId)`：内部辅助，按 `role` 查找，其次按名称兼容旧数据，最后才新建。
- **`countTotalReposByTagId`：含子级合计改到 SQL 侧（修订）**：
  - 原实现把 `repo_tags` 全量拉进 JS 做 `Set` 合并（由深到浅），规模上万后 `/api/tags` 会变慢，且可能与 SQL 计数口径漂移。
  - 现改为递归 CTE 展开"每个标签 → 子孙"的映射后再 `COUNT(DISTINCT rt.repo_id)`，同样带 `depth < TAG_MAX_DEPTH` 上限防成环。
  - 实测（libsql 本地文件库，5 次取中位数）：363 标签 / 6k 关联下 SQL 侧 15.2 ms vs 内存侧约 16 ms；968 标签 / 20k 关联下 48.4 ms vs 约 40 ms——**同一量级**，但省掉了把上万行拉进 JS 内存的过程，且口径与 SQL 一致。
  - 保留无层级时（`hasHierarchy === false`）跳过该查询的短路：此时含子级合计恒等于自身数量。

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
  - 表格新增"子标签数"列；「仓库数」列显示含子级合计（有子标签时附「自身 N」并用 Tooltip 说明）。
  - **表格改为 antd 树形表格（修订）**：扁平数据在前端由 `buildTagTree()` 组装成 `children` 结构喂给 `Table`，`pagination={false}` + `defaultExpandAllRows`。
    - 理由：分页会把父子割裂到不同页，层级信息失去意义。
    - 搜索语义：节点自身命中，或任意后代命中，节点都保留——即**保留命中节点的祖先链**，不会搜到子标签却看不到它归属谁；同级按名称排序。
    - 层级由缩进表达，标签列不再重复渲染 path 前缀。
  - 新建/编辑弹窗新增"父级" `Select`：选项按层级缩进，排除自身与其所有子孙。
  - 顶部新增「层级图」按钮，跳转 `/tags/tree`。
  - 删除确认文案改为"N 个子标签将移动到「{当前名称}」下"；专用标签（`role === 'orphan'`）行的删除按钮置灰 + Tooltip 说明，编辑弹窗的「父标签」`Select` 置灰并给出文案。
- `app/components/FilterBar.tsx`（修改）：标签下拉按层级缩进 + 显示完整路径，数量改为含子级合计（复用现有 `optionRender` 机制，搜索仍按 label 过滤）。
- `app/components/TagTreeChart.tsx`（新增，client component）：
  - 按需引入 `echarts/core` + `TreeChart` + `TooltipComponent` + `CanvasRenderer`。
  - props：`tags`、`selectedId`、`onSelect`、`depthMode`、`focusId`、`orient`、`height`。
  - 内部构建虚拟 root 后 `setOption`；`ResizeObserver` 触发 `resize()`；卸载 `dispose()`。
  - `chart.on('click')` 命中节点时回调 `onSelect`。
  - **搜索定位只展开祖先链（修订）**：新增 `focusId`，`buildTree` 沿 `parentId` 回溯出「焦点节点 + 祖先链」，只对这些节点设 `collapsed: false`，其余全部收起。
    - 原实现是命中后直接 `initialTreeDepth = -1` 全部展开，标签一多整棵树摊开反而更难找。
    - 用 ECharts SSR 实测：定位「平台 / iOS / Swift」时 Swift 可见，无关分支（如「性质 / 开源项目」）不再出现。祖先的兄弟节点仍会露出，属正常的树形定位行为。
- `app/components/TagTreePage.tsx`（新增）：页面骨架 = 控件行（展开档位、orient、搜索定位）+ 图 + 右侧详情面板 + 返回按钮。详情面板对专用标签给出"该标签本身不支持删除"的说明。
- `app/components/RepoList.tsx`（修改，**修订**）：拿到 `/api/tags` 后校验当前 `?tag=<id>`，若该 id 不在标签列表中（标签已被删除或不属于当前用户），用 `router.replace` 把筛选重置为 `all` 并 `message.info` 提示，同时清掉 `page`。用 `replace` 而非 `push`，避免污染前进后退历史。
  - 背景：原先这种情况会静默返回空列表，筛选栏下拉里也没有这一项，只显示裸 id。
- 图表组件用 `dynamic(..., { ssr: false })` 引入，仅进入层级图页面时加载 ECharts。

### 6. 依赖

- `npm i echarts`（6.1.0），按需引入 `TreeChart`；动态加载，标签管理页首屏不受影响。

## 影响范围

- 修改：`lib/db/schema.ts`、`lib/db/tags.ts`、`lib/db/repos.ts`、`app/api/tags/route.ts`、`app/api/tags/[id]/route.ts`、`app/components/TagManager.tsx`、`app/components/FilterBar.tsx`、`app/components/RepoList.tsx`、`lib/tag-limits.ts`、`lib/db/tags.test.ts`、`lib/db/repos.test.ts`、`package.json`。
- 新增：`drizzle/0002_*.sql` + `drizzle/0003_*.sql` + `drizzle/meta/*`、`app/tags/tree/page.tsx`、`app/components/TagTreePage.tsx`、`app/components/TagTreeChart.tsx`。
- 不动：repo 的同步逻辑、`RepoCard` / `TagSelect` 的打标交互、现有"未打标"筛选语义、全局样式、`AppShell` 导航。

## 验收与验证

- 单测（`lib/db/tags.test.ts` 扩充）：
  - 新建标签默认 `parentId` 为 `NULL`；指定父级后 `depth` / `path` 正确。
  - 修改父级生效；移到顶级（`parentId = null`）生效。
  - 拒绝自引用、拒绝把父级设为子孙（防环）。
  - 超过 `TAG_MAX_DEPTH` 时拒绝。
  - 删除有子标签的标签后，子标签被移到「已删除待处理」下。
  - **拒绝删除专用标签**，且数据完好（标签还在、子标签仍挂在它下面）。
  - **专用标签改名后仍是同一枚标签**：`role` 不变、id 不变、依然拒绝删除、依然拒绝改父级。
  - 专用标签被手动挂成某个标签的子标签时，删除其父级不会自引用（提升为顶级）。
  - 每个标签的 `role` 正确返回（普通标签 `null`、专用标签 `'orphan'`）。
  - 含子级合计：同一 repo 经多条路径命中只算一次（父 + 子同时打标时父级合计为 1）。
  - `listTagSubtreeIds` 多层展开正确；仓库筛选按子树匹配。
- 手动验证：
  - `/tags` → 「层级图」进入独立页面，树正确渲染；展开/折叠、全部展开、收起正常。
  - 点击节点右侧详情正确，跳转 `/repos?tag=<id>` 后筛选栏选中且结果含子标签仓库。
  - 搜索定位只展开命中节点的祖先链（无关分支保持收起）并高亮；`LR` / `TB` 切换正常；明暗主题下可读。
  - 编辑标签改父级后，`/tags` 表格 path 与层级图同步更新。
  - 删除父标签后子标签出现在「已删除待处理」下，且可再手动改父级。
  - 专用标签的删除按钮置灰、编辑弹窗父级选择器置灰，改名后限制依然成立。
  - `/tags` 表格以树形展示，搜索时保留命中节点的祖先链。
  - 用已删除标签的 id 访问 `/repos?tag=<id>`，筛选被重置为「全部」并有提示。
- 工程检查：`npx tsc --noEmit`（`scripts/` 下既有报错除外）、`npx eslint` 改动文件、`npx vitest run` 无新增失败（`lib/api-error.test.ts` 为改动前已存在的失败）。
- 迁移验证：在空库和含既有标签的库各跑一次 `db:migrate`，确认旧数据 `parent_id`、`role` 全为 `NULL`（即全部是普通顶级标签）且页面正常。`0003` 是新增可空列，老数据无需回填。

## 风险与对策

- **递归 CTE 跑飞**：所有 CTE 一律带 `depth < TAG_MAX_DEPTH` 上限（已实测必要性，无上限会 OOM）。
- **并发改父级绕过校验成环（TOCTOU）**：校验与写入放进同一 `db.transaction`，消除"两处都读到合法旧值、然后各自写入"的窗口（修订）。
- **删除父标签被外键拒绝**：事务内先 reparent 子标签再删除。
- **专用标签身份丢失**：不按名称判断，改用 `tags.role`（修订）。
- **层级过深图拥挤**：`TAG_MAX_DEPTH = 5` + 折叠 + `roam` + `LR/TB` 切换（性能无压力，主要是可读性）。
- **迁移需上生产库**：先在测试库验证，再走现有部署流程执行 `db:migrate`。
- **老数据全是 1 级**：初期层级图是一片扁平，属预期；文案提示"还没有子标签，编辑标签可指定父级"。

## 不在本次范围内

- 共现关系图（上一版方案）。
- 拖拽调整层级（用 Select 选父级即可）。
- 标签合并 / 批量重命名。
- 词云、treemap 等其他可视化。
- 在 `AppShell` 顶部导航增加层级图入口（先只从 `/tags` 页进入）。
