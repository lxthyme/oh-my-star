# 标签维度表达与多选筛选 — 设计文档（后续方案）

- 日期：2026-10-16
- 状态：待排期（建议在层级方案 `2026-10-16-tag-hierarchy-and-tree-view-design.md` 落地后实施）
- 定位：层级方案的**补充**，不改变"单父级树"的数据模型

## 背景

讨论中提出的场景：「开源项目」标签下有很多 repo，它们有的属于 iOS、有的属于 Web、有的属于 Flutter。

这个场景要分清两件事：

| 诉求 | 本质 | 现有能力 |
|---|---|---|
| 一个 repo 同时属于「开源项目」和「Flutter」 | repo 多标签 | ✅ 已支持（`repo_tags` 主键 `(user_id, repo_id, tag_id)` 天然多对多） |
| 筛出「开源项目 **且** Flutter」的 repo | 组合筛选（AND） | ❌ 不支持（`FilterBar` 标签是单选，`listRepos` 只接受单个 `tagId`） |
| 让「iOS」同时挂在「平台」和「开源项目」两个分类下 | 标签多父级（DAG） | ❌ 不支持，且本方案**不做** |

**结论**：场景里的真实卡点是**组合筛选**，不是层级模型。因此本期用"**维度并列 + 多选筛选**"解决，不引入多父级（DAG）。

## 需求范围

1. **语义约定（靠约定而非新字段）**：树表达"从属 / 细分"，**不表达"维度"**；**顶级标签当"维度"用**（如 `平台` / `性质` / `语言`），各自下面再细分。`iOS` 归在「平台」下，`开源项目` 归在「性质」下，互不冲突，无需多父级。
2. **筛选栏标签支持多选（AND 语义）**：选中 `开源项目` + `Flutter` = 同时命中两者的 repo。
3. **筛选栏按顶级标签分组展示**（antd `Select` 的 group 结构），维度感直接可见。
4. **多选与层级的协同**：选中父标签时按子树展开（沿用层级方案口径）；多个选中项之间取 AND。
5. **计数口径沿用层级方案**：下拉里每个标签显示**含子级合计**，tooltip 区分自身 / 含子级。
6. `/tags` 表格按顶级标签分组展示（可选，视层级方案落地后的表格形态决定）。

## 实现设计

### 1. 数据层 `lib/db/repos.ts`

- `RepoListParams` 的 `tagId?: number | "untagged"` 替换为：

```ts
tagIds?: number[] | "untagged"
```

- `buildWhere` 中：
  - `"untagged"`：保持现有 `NOT EXISTS (...)` 语义不变，且与 `tagIds` 互斥。
  - 数组：对**每个** tagId 各追加一个 `EXISTS (SELECT 1 FROM repo_tags WHERE repo_id = ... AND user_id = ... AND tag_id = ?)`，即 AND 语义。
  - 空数组 / undefined：等同不筛选。

### 2. 多选 × 层级的命中语义

- 每个被选中的标签先展开成它的**子树 id 集合**（复用层级方案的 `listTagSubtreeIds`，带 `depth < TAG_MAX_DEPTH` 上限）。
- 命中条件：repo 在**每一个**被选标签的子树集合中至少命中一个（AND of ORs）。
- 例：选 `开源项目`（父）+ `平台 / Flutter`（子）→ 只要同时打了「开源项目」和「Flutter」（或其子孙）的 repo。

### 3. URL 与前端状态

- `FilterValues`：`tag: string` → `tags: string[]`。
  - `[]` = 全部；
  - `["untagged"]` = 未打标，与其他值互斥（选中时清空其他项）；
  - 其余元素为标签 id 字符串。
- URL 形态：`?tag=1,2`（逗号分隔，**向后兼容单值** `?tag=1`）、`?tag=untagged`。
- `RepoList` 内的 `filtersFromSearchParams` 相应改为 `sp.get("tag")?.split(",") ?? []`；`updateFilters` 写回时用 `join(",")`（空数组则不写 `tag`）。
- 注意：`updateFilters` / `updatePage` 现在直接把 filters 展开进 `URLSearchParams`，数组需要显式 join。

### 4. `FilterBar`

- 标签 `Select` 增加 `mode="multiple"`、`maxTagCount="responsive"`。
- `options` 改为分组结构：组名 = 顶级标签名，组内 = 该维度下的标签（层级方案落地后按 `parentId` 组装）；`标签：全部` / `未打标` 作为分组之外的独立项。
- 保留现有 `optionRender`（右侧显示 repo 数量），数量沿用"含子级合计"。
- 选中 `未打标` 时禁用其他选项（互斥）。

### 5. 与层级方案的衔接

- 本方案**依赖**层级方案提供：`parentId`、`path`、`listTagSubtreeIds`、含子级计数。
- 若层级方案未落地，本方案可降级实施：只做多选 + 单标签 EXISTS（不做子树展开、不做分组），后续补齐。

## 影响范围

- 修改：`lib/db/repos.ts`（参数与 `buildWhere`）、`app/components/RepoList.tsx`（`filtersFromSearchParams` / `updateFilters` / 发起请求时的参数拼装）、`app/components/FilterBar.tsx`（多选 + 分组 options）、`lib/db/repos.test.ts`（多标签 AND 用例）。
- 可能涉及：`app/components/TagManager.tsx`（表格分组展示，可选）。
- 不动：数据库 schema、`RepoCard` / `TagSelect` 的打标交互、层级方案本身的模型。

## 验收与验证

- 单测（`lib/db/repos.test.ts` 扩充）：
  - 同时选中两个标签时只返回同时命中两者的 repo（AND）。
  - 选中「父标签 + 另一分支标签」时按子树展开后取 AND。
  - `untagged` 与多选互斥，语义不变。
  - `tagIds` 为空时等同不筛选。
- 手动验证：
  - 筛选栏可多选，选中后 URL 为 `?tag=1,2`，刷新页面后筛选状态保持。
  - 选项按维度分组，右侧数量正确（含子级合计）。
  - 选中 `未打标` 后其他项被禁用。
  - 与语言、收藏、备注等其他筛选条件叠加正常。
- 工程检查：`npx tsc --noEmit`、`npx eslint` 改动文件、`npx vitest run` 无新增失败。

## 不在本次范围内

- **标签多父级（DAG）**——见下节。
- OR 模式（任一命中）、排除（NOT）标签筛选。
- 标签维度的强制校验（如"必须属于某个维度"），仅靠约定。
- 给维度新增 `dimension` 字段：用顶级标签承担，不新增列。

## 附：何时才需要升级到多父级（DAG）

**判断标准**：当你需要"**同一个标签属于多个分类**"（例如 `iOS` 既要归到「平台」，也要归到「我熟悉的」），而"维度并列 + 多选筛选"已经无法满足时，才引入 DAG。仅为了"从不同角度浏览"而要多父级，用多选筛选即可。

**升级改造清单**（届时需重新出设计文档）：

1. **schema**：新增 `tag_parents(child_id, parent_id)` 关联表替代 `parentId` 单列。
2. **可视化**：ECharts `tree` 只接受严格树，DAG 必须换方案——要么把节点复制成多份（会被误读为不同标签，且"含子级合计"重复计数），要么改用 `graph` + 自写层级布局；**折叠 / 展开需要自己实现**（`tree` 的 `expandAndCollapse` 无法复用）。
3. **计数去重**：同一 repo 经两条父路径命中同一标签时，"含子级合计"必须去重。
4. **筛选**：子树闭包从"单起点递归"变为"多起点可达 + `UNION` 去重"；防环更复杂（已实测递归 CTE 成环会跑到 OOM，**必须带 `depth` 上限**）。
5. **删除规则**：子标签仍存在其他父级时，不应移到「已删除待处理」。
6. **编辑 UI**：父级从单选变多选；一个标签存在多条 `path`，表格与下拉的展示需要定规则。
