# KnowledgeOS · 浅色主题 UI/UX 设计稿

| 项 | 内容 |
| --- | --- |
| 版本 | v1.0（主题设计稿） |
| 日期 | 2026-10-31 |
| 上游 | `docs/UI_UX_DESIGN.md` v0.1.2、`docs/UIUX_V1.5_Wiki.md` v0.1 |
| 姊妹文档 | `docs/UIUX_THEME_DARK.md` |
| 定位 | 深浅两套主题中的**主设计**；深色在其基础上重新打光，不是反相 |
| 覆盖 | V1 五页 + V1.5 Wiki 的关键表面（冲突、diff、证据锚点） |

---

## 1. 为什么浅色是主设计

产品定位是「可索引的书」，阅读是主要动作。浅色在长文阅读上有客观优势：瞳孔不需要频繁调节，屏幕反射与纸面直觉一致，打印与截图分享也更自然。

所以浅色不是「默认主题」，是**基准主题**。深色是同一套语义在暗光环境下的等价实现，必须能通过同样的验收，但不反过来约束浅色的设计。

### 1.1 这一版要修正的问题

v0.1.2 的配色整体可用，但有一处硬伤：

**表单控件的边框对比度不达标。** 原 `--line-strong: #D5CFC0` 在白底上的对比度约 1.5:1，而 WCAG 1.4.11 要求可交互控件的边界至少 3:1。这意味着在低质量屏幕上，输入框的边界可能完全看不见。

本版引入 `--line-control: #9A9284`（3.08:1），只用于可交互控件的边界；`#D5CFC0` 降级为装饰性分隔线，不再承担「让用户看出这里有输入框」的职责。

**这条不是审美调整，是可用性修复。** 深色主题里会有对应的一条：控件边框单独取色，不与普通分隔线共用。

---

## 2. 共享语义令牌契约

两套主题必须映射到同一组语义名。**组件只引用语义名，绝不引用具体色值**，否则换主题时要改组件。

### 2.1 契约表

| 语义令牌 | 含义 | 浅色取值 | 深色取值（对照） |
| --- | --- | --- | --- |
| `--surface-app` | 应用外壳背景 | `#FBFAF7` | `#121110` |
| `--surface-canvas` | 内容画布（阅读区、卡片） | `#FFFFFF` | `#191715` |
| `--surface-sunken` | 下沉区（表头、代码块、影响范围） | `#F4F1EA` | `#211E1A` |
| `--surface-raised` | 抬升区（浮层、抽屉、弹窗） | `#FFFFFF` | `#24211D` |
| `--text-primary` | 主文本 | `#1B1A17` | `#EDE9E0` |
| `--text-secondary` | 次级文本 | `#3A3833` | `#C4BEB2` |
| `--text-muted` | 辅助文本、时间戳 | `#6B675E` | `#938D80` |
| `--text-disabled` | 禁用、占位符 | `#8C8779` | `#6B665C` |
| `--line-subtle` | 发丝分隔线 | `#E6E1D6` | `#2C2925` |
| `--line` | 标准分隔、卡片边框 | `#D5CFC0` | `#3A352E` |
| `--line-control` | **可交互控件边界**（≥3:1） | `#9A9284` | `#6E675A` |
| `--accent` | 强调色：链接、角标、主按钮 | `#2C5A5F` | `#6FA8A6` |
| `--accent-weak` | 强调底纹 | `#E8F0F0` | `#1B2A2A` |
| `--accent-border` | 强调边框（角标描边） | `#CFDFDF` | `#2F4A4A` |
| `--on-accent` | 强调色之上的文字 | `#FFFFFF` | `#121110` |
| `--highlight` | 被引用段落底色 | `#FBF0D9` | `#3A2F1C` |
| `--success` | 成功 | `#4E6B45` | `#7FA276` |
| `--warning` | 警告、可能过期 | `#9B6A22` | `#D6A45C` |
| `--danger` | 危险、失败、删除 | `#9E2B25` | `#E07A70` |
| `--state-success-bg` | 成功底纹 | `#F2F6F0` | `#1E2A1D` |
| `--state-success-border` | 成功描边 | `#CBD9C6` | `#3C5538` |
| `--state-warn-bg` | 警告底纹 | `#FBF4E8` | `#2E2618` |
| `--state-warn-border` | 警告描边 | `#E4D3B4` | `#5C4A2A` |
| `--state-danger-bg` | 危险底纹（含 diff 删除、冲突横幅） | `#FAEFEE` | `#2E1D1C` |
| `--state-danger-border` | 危险描边 | `#E3C9C6` | `#5E3A36` |
| `--toast-bg` | 瞬时提示背景 | `#1B1A17` | `#EDE9E0` |
| `--toast-fg` | 瞬时提示文字 | `#FFFFFF` | `#171614` |
| `--scrim` | 遮罩 | `rgba(27,26,23,.28)` | `rgba(0,0,0,.56)` |
| `--shadow-overlay` | 浮层阴影 | `0 8px 24px rgba(27,26,23,.08), 0 1px 2px rgba(27,26,23,.04)` | 同结构，透明度加倍 |
| `--docbar-bg` | 吸顶信息条背景 | `rgba(251,250,247,.94)` | `rgba(18,17,16,.92)` |

### 2.2 命名迁移

v0.1.2 用的是 `--paper-*` / `--ink-*`。这套名字在浅色下成立，在深色下会误导（「纸」是黑的）。

处理方式：**保留旧名作为别名，新代码一律用语义名。**

```css
:root {
  --paper-0: var(--surface-canvas);
  --paper-1: var(--surface-app);
  --paper-2: var(--surface-sunken);
  --ink-900: var(--text-primary);
  --ink-700: var(--text-secondary);
  --ink-500: var(--text-muted);
  --ink-400: var(--text-disabled);
  --line-strong: var(--line-control);
}
```

别名只存在于主题定义层，组件里出现 `--paper-*` 视为待清理。

---

## 3. 浅色主题取值与对比度

### 3.1 表面与文本

| 组合 | 对比度 | 判定 |
| --- | --- | --- |
| `--text-primary` on `--surface-canvas` | 16.5:1 | 通过（AAA） |
| `--text-primary` on `--surface-app` | 15.9:1 | 通过 |
| `--text-secondary` on `--surface-canvas` | 10.8:1 | 通过 |
| `--text-muted` on `--surface-canvas` | 5.6:1 | 通过（AA 正文） |
| `--text-muted` on `--surface-sunken` | 4.9:1 | 通过 |
| `--text-disabled` on `--surface-canvas` | 3.6:1 | 仅用于非信息性文本 |
| `--accent` on `--surface-canvas` | 7.2:1 | 通过（链接、角标） |
| `--on-accent` on `--accent` | 7.2:1 | 通过 |
| `--line-control` on `--surface-canvas` | 3.08:1 | 通过（控件边界） |
| `--line` on `--surface-canvas` | 1.5:1 | 仅装饰，不传递交互信息 |

### 3.2 状态色

| 组合 | 对比度 | 说明 |
| --- | --- | --- |
| `--success` on `--state-success-bg` | 5.1:1 | 徽标文字 |
| `--warning` on `--state-warn-bg` | 4.6:1 | 徽标文字 |
| `--danger` on `--state-danger-bg` | 5.9:1 | 徽标文字 |
| `--text-primary` on `--highlight` | 14.2:1 | 引用高亮段落 |
| `--accent` on `--accent-weak` | 6.4:1 | 选中行、角标底 |

**状态色一律「深字 + 浅底 + 同色系描边」三件套。** 只给底色不给描边，在低对比屏幕上会糊成一片；只给描边不给底色，密度高的列表里会看不出状态。

### 3.3 浅色主题的三条禁忌

其一，**不用纯白做应用外壳。** `#FFFFFF` 只给内容画布。外壳和画布同色会让「哪里是工具、哪里是材料」的边界消失。

其二，**不用纯黑做正文。** `#000000` 在暖白底上会产生光晕，长时间阅读易疲劳。用 `#1B1A17`，略带暖调。

其三，**不靠阴影做层级。** 层级只由表面明度和 1px 边框表达；阴影只保留给真正浮起的元素（抽屉、弹层、命令面板）。

---

## 4. 组件适配

### 4.1 按钮

| 变体 | 背景 | 文字 | 边框 |
| --- | --- | --- | --- |
| primary | `--accent` | `--on-accent` | 同背景 |
| secondary | `--surface-canvas` | `--text-primary` | `--line-control` |
| ghost | 透明 | `--text-secondary` | 无 |
| danger | `--surface-canvas` | `--danger` | `--state-danger-border` |

hover 统一为「背景降一级」（primary 加深、secondary 转 `--surface-sunken`），**不做位移与放大**。

### 4.2 输入控件

- 边框 1px `--line-control`。
- 聚焦时 2px `--accent` 外扩 1px，边框同步变 accent。**不能只换颜色不换粗细**，否则色盲用户感知不到。
- 错误态边框 `--danger`，并在下方显示文字说明，不只靠颜色。
- 禁用态：背景 `--surface-sunken`，文字 `--text-disabled`，边框 `--line-subtle`。

### 4.3 徽标与标签

徽标（状态）用状态三件套；标签（用户自定义）用 `--surface-sunken` + `--text-secondary`，**不引入第二种语义色系**。

### 4.4 表格

表头 `--surface-sunken`，行分隔 `--line-subtle`，hover 行 `--surface-sunken`。**斑马纹不用**——本产品行内有多种状态色，再叠斑马纹会乱。

### 4.5 引用高亮与块边界

引用高亮用 `--highlight` 底 + 左侧 2px `--accent` 竖条；块边界虚线用 `--line-subtle`，检查模式下降到 `--line`。高亮持续 2 秒后渐隐，**渐隐只改透明度，不改颜色**。

---

## 5. 页面级差异

### 5.1 总览

指标卡 `--surface-canvas` + `--line` 边框。V1.5 未开放的三张卡用 `--text-disabled` 显示「—」，**不加灰底**——灰底会让人以为加载失败。

### 5.2 知识库

表格与工具条同在 `--surface-canvas` 上，工具条下方一条 `--line-subtle`。导入抽屉用 `--surface-raised`。

### 5.3 文档详情

正文区 `--surface-canvas`，吸顶信息条用 `--docbar-bg`（半透明 + 背景模糊）。右栏检查面板 `--surface-app`，与正文区分。

### 5.4 问答

用户气泡 `--surface-sunken`；助手回答**无背景**，直接在画布上。证据面板 `--surface-canvas` + 左侧 `--line`。角标用 `--accent` 文字 + `--accent-weak` 底 + `--accent-border` 描边。

### 5.5 设置

表单卡片 `--surface-canvas`；危险区只加 `--state-danger-border` 边框，**不铺红底**。

### 5.6 V1.5 的四个表面

| 元素 | 浅色做法 |
| --- | --- |
| 证据锚点 | `--accent` 实心/空心圆点，弱证据用 `--warning` |
| 状态徽章 | 六态，最多并列显示两个，危险在前 |
| 冲突横幅 | `--state-danger-bg` 底 + 左侧 3px `--danger` 竖条 + 1px `--state-danger-border` |
| 段落 diff | 新增 `--state-success-bg`、删除 `--state-danger-bg`、修改 `--state-warn-bg`，各配同色左侧竖条 |

---

## 6. 内容渲染

**图片。** 不做任何滤镜。浅色下截图与图表按原样显示。

**代码块。** 底 `--surface-sunken`，文字 `--text-primary`，mono 13/22。语法高亮只用三种色：关键字 `--accent`、字符串 `--success`、注释 `--text-muted`。**不做五彩高亮**，技术阅读里颜色越多越难扫。

**表格（Markdown）。** 与产品表格同构，表头 `--surface-sunken`。

**PDF。** 白色页面直接显示，不缩放不反色。

---

## 7. 主题切换机制

### 7.1 三种来源

| 来源 | 优先级 | 说明 |
| --- | --- | --- |
| 用户显式选择 | 最高 | 浅色 / 深色 / 跟随系统，三选一 |
| 系统偏好 | 中 | `prefers-color-scheme` |
| 默认 | 最低 | 浅色 |

首次访问跟随系统；用户一旦手动切换，就固定下来，不再跟随系统。

### 7.2 无闪烁

主题必须在首屏渲染前确定，不能等 JS 加载完再切——那会闪一下白。

实现要求：在 `<head>` 内联一段同步脚本，读取偏好并写入 `<html data-theme="...">`，**在任何样式表之前执行**。React 侧只负责后续的切换与持久化。

### 7.3 切换时不做的事

- 不做全局淡入淡出（会让整页闪一下）。
- 不做颜色过渡动画（120ms 的颜色渐变在深浅切换时显得脏）。
- 切换后保持滚动位置与浮层状态。

### 7.4 切换入口

图标栏底部、命令面板（`⌘K` → 「切换主题」）、设置页「外观」分组，三处都能切，状态同步。

---

## 8. 验收

- TL-1：任意页面文本与背景组合达到 AA（正文 4.5:1，大字 3:1）。
- TL-2：所有可交互控件的边界 ≥ 3:1（用 `--line-control`，不用 `--line`）。
- TL-3：去除颜色后，所有状态仍可由文字或图标区分。
- TL-4：首屏无主题闪烁（录屏逐帧检查）。
- TL-5：切换主题后滚动位置、打开的抽屉、正在播放的音频不受影响。
- TL-6：五页 + Wiki 两态在 390 / 768 / 1024 / 1440 四档宽度下，浅色主题均无横向滚动。
- TL-7：打印与导出 PDF 时，背景色不丢失（`print-color-adjust: exact`）。

---

## 9. 已知限制

**暖白在低亮度屏幕上偏黄。** 部分廉价 IPS 面板会把 `#FBFAF7` 显示成米黄。这不影响可用性，但截图分享时观感会有差异；可考虑提供「中性白」变体，暂不做。

**大面积纸色在夜间偏亮。** 这正是需要深色主题的原因，不在浅色里解决。

---

**下一步。** 深色主题见 `UIUX_THEME_DARK.md`；两套主题的令牌合并方式与构建期切换，在技术设计中落地。
