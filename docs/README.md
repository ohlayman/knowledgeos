# KnowledgeOS 文档索引

这个目录按「版本 × 文档类型」组织。先说清楚一件事：**`PRD.md` 就是 V1 的 PRD**，不是一份通用总纲——它的标题里已经标注「V1 基线」，全文 24 章都只覆盖 V1 范围。

## 一、按版本对照

| 版本 | PRD | UI/UX | 状态 |
| --- | --- | --- | --- |
| **V1**（基线） | `PRD.md` | `UI_UX_DESIGN.md` | 已定稿，进入实现 |
| **V1.5**（LLM Wiki） | `PRD_V1.5_Wiki.md` | `UIUX_V1.5_Wiki.md` | 已定稿，等 V1 验收 |
| **V2**（图谱 + Agent Studio） | `PRD_V2_Graph_Agent.md` | `UIUX_V2_Graph_Agent.md` | 已定稿，等 V1.5 |
| **V3**（MCP Server） | `PRD_V3_MCP.md` | `UIUX_V3_MCP.md` | 已定稿，等 V1 检索质量 |

## 二、跨版本文档

| 文档 | 内容 | 适用范围 |
| --- | --- | --- |
| `TECHNICAL_DESIGN.md` | 架构、模块边界、技术栈、检索/问答/安全设计、A-1/A-2 验证方案、版本扩展 | 全版本 |
| `DATABASE_DESIGN.md` | 完整 Prisma Schema、索引、约束、迁移、保留与备份 | 全版本 |
| `IMPLEMENTATION_PLAN.md` | M0–M8 任务拆解、验证命令、版本扩展里程碑、发布清单 | 全版本 |
| `PROGRESS.md` | 唯一进度台账：流程进度、任务看板、质量门禁 | 全版本 |
| `OPERATIONS.md` | 运维手册：启动、备份恢复、升级、保留策略、故障排查 | V1 |
| `UIUX_THEME_LIGHT.md` | 浅色主题：语义令牌契约、取值、对比度、切换机制 | 全版本 |
| `UIUX_THEME_DARK.md` | 深色主题：层级表达、取值、媒体内容、切换的暗色问题 | 全版本 |
| `../design/prototype.html` | 单文件可交互原型（V1 五页 + V1.5 Wiki 两态 + V2 图谱/Agent + V3 MCP 接入 + 主题切换） | 全版本 |

## 三、四段式流程的进度

按既定流程，每个版本要依次产出四份文档。当前进度：

| 文档 | 是否产出 | 说明 |
| --- | --- | --- |
| PRD | V1–V3 已全部产出 | 见上表 |
| TECHNICAL_DESIGN.md | 已产出 | 一套主文档，V1 详细，V1.5/V2/V3 为扩展章节 |
| DATABASE_DESIGN.md | 已产出 | 全版本表一次建好，后续只做增量迁移 |
| IMPLEMENTATION_PLAN.md | 已产出 | V1 逐任务可执行，后续版本里程碑级 |

**当前进度：V1 编码进行中。** 设计文档已定稿，M0–M6 已完成，正在推进 M7 运维与发布；进度以 `PROGRESS.md` 为唯一台账。

需要注意的是：**四个版本的 PRD 是并行评审、串行实现的。** V2 依赖 V1.5 的实体抽取质量，V3 依赖 V1 的检索质量，因此实现顺序仍是 V1 → V1.5 → V2 → V3，不能因为 V3 文档写完了就先做 V3。

## 四、命名约定

后续新增文档时按这个规则，避免再次出现「基准版没有版本号」的情况：

```text
PRD_V<x>_<主题>.md           例：PRD_V2_Graph_Agent.md
UIUX_V<x>_<主题>.md          例：UIUX_V2_Graph_Agent.md
TECHNICAL_DESIGN_V<x>.md     例：TECHNICAL_DESIGN_V1.md
DATABASE_DESIGN_V<x>.md
IMPLEMENTATION_PLAN_V<x>.md
```

**当前例外：** 技术设计、数据库设计、实现计划采用「一套主文档 + 版本扩展章节」，文件名不带版本号（`TECHNICAL_DESIGN.md`、`DATABASE_DESIGN.md`、`IMPLEMENTATION_PLAN.md`）。这样 V1 的详细设计与 V1.5/V2/V3 的扩展共用一个事实源，避免四套文档内容分叉。只有当某个版本的实现需要完全独立的设计时，才按上面的规则拆出带版本号的新文件。

历史例外：V1 的两份文档保留原名（`PRD.md`、`UI_UX_DESIGN.md`），因为已在多处被引用。**若后续决定统一改名，需要同步更新所有交叉引用与外部链接**，不要只改文件名。

## 五、先读哪份

第一次接触这个项目，建议顺序：

1. `PRD.md` 的第 0.3 节与第 7.3 节——五分钟内搞清 V1 到底做什么、不做什么。
2. `PRD.md` 第 21 章——看清三个版本的分界。
3. `UIUX_THEME_LIGHT.md` 第 2 章——一套语义令牌，全版本共用。
4. `design/prototype.html`——直接点开，比读文档快。
