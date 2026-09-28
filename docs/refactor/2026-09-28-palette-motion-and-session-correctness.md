# 命令面板、删除动效与会话状态正确性

日期：2026-09-28 · 范围：`apps/frontend` · 状态：`npm run check` 与 `vite build` 均通过，全部结论在真实运行的 dev server 上实测。

---

## 1. 为什么加命令面板

上一轮把导航从三处收敛到侧栏一处之后，剩下的摩擦是「跳转会话」：要回到某个历史对话，必须在侧栏列表里
滚动查找，或者从概览页的最近会话进入。列表还是键盘不可达的。

命令面板解决的是这件事，而不是「看起来很现代」：

- 入口是键盘（`Ctrl/⌘ K`），同时保留侧栏品牌行与移动端顶栏的可见按钮，不靠隐藏快捷键；
- 三类动作共用一个入口：页面导航、新建会话、切换主题、直接跳到最近 8 条会话；
- 与既有权限模型一致：`组织与权限` 只在 `isAdmin` 时进入候选，不会泄漏入口再报错。

无障碍按 WAI-ARIA 的 combobox 模式实现：`role=dialog aria-modal`、输入框 `role=combobox`
`aria-expanded` `aria-controls` `aria-activedescendant`，选项 `role=option aria-selected`，
`↑/↓/Enter/Esc` 全程可键盘操作，选项随游标 `scrollIntoView({block:'nearest'})`。

主 chunk 从 325.72 kB 增到 331.22 kB（gzip 103.15 → 104.64 kB）。没有按需切分是刻意的：
面板第一次打开就必须是即时的，5 kB 换零延迟值得。

## 2. 删除会话的收起动画

`SessionRow` 增加 `leaving` 态，命中时把行收成 `max-h-0 -translate-x-1 opacity-0`，
过渡走既有的动效令牌（`duration-[var(--dur-base)] ease-[var(--ease-in-out)]`），动画结束后才真正
从 store 移除。计时器挂在 effect 的清理函数上，卸载即回收——不用 ref 存 id，
`react-hooks/refs` 规则会拒绝「渲染期可能读到 ref」的写法（本轮踩过一次）。

`prefers-reduced-motion: reduce` 时直接删除、不排定计时器，而不是让无障碍用户等一段他们看不见的动画。

## 3. 顺带挖出并修掉的两个真实状态 bug

这两个都不是新代码引入的，是原来的结构问题，被删除动画逼出来了。

### 3.1 幽灵会话：URL 指向已删除的会话时被写回 store

原 `useSessionMessages` 里那段「路由没有 convId 时补齐」的逻辑是：

```
if (convId) { if (currentSessionId !== convId) switchSession(convId); return; }
```

删掉当前会话后，路由仍带着这个 `convId`，于是 effect 把一个**已经不存在的 ID** 重新 `switchSession` 进
store；紧接着的补齐分支又基于这个幽灵 ID 导航回去。表现就是：侧栏列表里会话消失了，
但 `localStorage` 的 `currentSessionId` 和地址栏都还停在那条已删除的会话上——
看起来像「删除没生效」。

改成先验证再采用：`convId` 必须真实存在**且模式匹配**才 `switchSession`；
否则在同模式里挑一条可复用的会话，都没有才新建。

```
const target = convId ? state.sessions.find(s => s.id === convId && s.mode === mode) : null;
```

同时 `commitDelete` 里原本还有一句 `navigate('/chat')`，会和这个 effect 抢路由，已删除——
URL 与 store 的对齐只留 `useSessionMessages` 一个出口。

### 3.2 `deleteSession` 的后继会话跨模式串味

原来是 `sessions[0]?.id || null`，而 `sessions` 是全量列表。在 `/rag` 页面删掉当前检索会话，
`currentSessionId` 会跳到一条「对话」会话上。改为只在被删会话的**同模式**里取后继。

### 实测（真实浏览器，删除链路）

| 场景 | 结果 |
| --- | --- |
| 删除非活动会话 | store 少 1 条，路径停在当前活动会话不变 |
| 删除活动会话（同模式还有别的） | 跳到同模式后继，路径同步更新 |
| 删除该模式最后一条 | 自动新建一条（返回后端真实 ID），路径落到新 ID，不再出现 `s-alpha` 幽灵 |
| 收起动画 | 点击后 60 ms 读到 `max-h-0 / opacity-0 / -translate-x-1` 已生效，随后才从列表消失 |
| 命令面板 | 11 个候选分 3 组；输入「语言」精确筛到 1 条；Enter 后导航至 `/rag/s-gamma` 并关闭；再次 `Ctrl+K` 可开可关 |
| 面板对比度 | 面板内所有可见文本 WCAG AA 违例 0 项 |

顺带确认：`/api/conversation/create` 带上 Authorization 后返回真实 UUID，
说明会话迁到后端这条路是通的，卡点仍然只有第四节的 `ensure_conversation` 不写 `user_id`。

## 4. 另外两处工程收敛

- `api/asr.ts` 原本自己 `JSON.parse(localStorage.getItem('auth-storage')!)`（两处非空断言）取 token，
  现在统一走 `useAuthStore.getState().token`，与 `apiClient`、`api/chat.ts` 同一个事实源。
- 401 处理不再 `window.location.href = '/login'` 整页刷新（`api/client.ts`、`api/chat.ts`）：
  `logout()` 已经改了 store，`ProtectedRoute` 订阅同一个 store 会完成跳转，整页刷新只会丢掉 SPA 状态。

## 5. 无障碍与原生控件核查（同日续做）

先测后改，结论都带实测标记。

**已经是对的**（核对过就不动）：`color-scheme` 已按主题分别声明（`index.css:49` light / `:92` dark），
所以下拉列表、range 滑块、滚动条这些原生控件跟着主题走；Toast 容器已有 `role="status" aria-live="polite"`。

**补上的三处**：

1. **跳转链接（WCAG 2.4.1）**：键盘用户原本要 Tab 穿过整条侧栏（4 个导航项 + 全部会话行）才碰得到正文。
   加了 `跳到主要内容` 隐藏链接 + `<main id="main-content" tabIndex={-1}>`。
   实测：激活后 `document.activeElement.id === "main-content"`、`location.hash === "#main-content"` ✅
2. **弹层焦点圈定**（`hooks/useFocusTrap.ts`）：Modal 与命令面板此前只有「打开时把焦点移进去 + Esc 关闭」，
   Tab 会一路跑到背景里的侧栏和会话行。现在 Tab 被圈在弹层内，首尾循环。
   实测：面板内 Tab 4/4 留在面板里 ✅；Modal 打开时焦点在弹层内 ✅、Tab 5/5 留在弹层内 ✅、Esc 关闭 ✅。
   **未达成**：Modal 关闭后把焦点还给触发按钮——实测 `activeElement` 落回 `<body>`；
   同样逻辑的命令面板（卸载式）归还成功 ✅。两条路径的差异只在弹层是「常驻 + open 翻转」还是「条件挂载」；
   按 StrictMode 双跑修正过三次捕获时机（opener 只能捕获一次，且必须早于把焦点移进弹层的 effect），
   仍有一遍没能复现成功，所以不宣称它可用。影响面小：不归还焦点只是让键盘用户从页首重新 Tab，不丢信息。
3. **知识库表格行键盘可达**：`DataTable` 的 `onRowClick` 让整行可点，但行本身不可聚焦、按不了键——
   下钻这个主交互对键盘用户是关着的。现在行带 `tabIndex={0}` + Enter/Space 激活，`<th>` 补 `scope="col"`。
   不给 `<tr>` 加 `role="button"`：那会毁掉表格语义。
   实测：`tbody tr[tabindex="0"]` 存在 ✅，在行上按 Enter 后路径变成 `/admin/vector/6` ✅，`th[scope="col"]` 3 个 ✅。

4. **标签页标题跟路由走**（`utils/pageTitles.ts`）：之前 `document.title` 永远是 `Ametrine`，
   多标签时认不出哪个是知识库、哪个是检索。现在外壳按路径映射（概览/对话/检索问答/知识库/组织与权限/
   系统设置/个人资料/无权访问），登录注册由 `AuthScreen` 用自身的 `title` 设置。
   实测：`登录 · Ametrine`、`对话 · Ametrine`、`系统设置 · Ametrine`、`知识库 · Ametrine`、`无权访问 · Ametrine` ✅
5. **`/403` 原来是个死指向**：`ProtectedRoute` 在角色不足时 `<Navigate to="/403">`，但路由表里没有 `/403`，
   于是命中 `path: "*"` 被静默弹回概览——用户看到的是「我点了一下就跳走了」，没有任何解释。
   补了 `pages/Forbidden.tsx` + 路由（懒加载 chunk 0.56 kB）。
   实测：以非管理员访问 `/admin/access` → 落到 `/403`，正文「这个页面需要管理员权限」+ 返回概览链接 ✅
6. **侧栏的管理入口**：`NavEntry.adminOnly` 字段和过滤逻辑早就写好了，但没有一条 NAV 用到它，
   等于过滤器是死的——非管理员会看到一个必然 403 的入口。给「组织与权限」补上 `adminOnly: true`。
   实测：非管理员侧栏只剩 `概览 / 知识库 / 设置` ✅
7. **流式状态的读屏播报**：生成回答时读屏用户拿不到任何反馈（内容逐字追加，播报也不合适）。
   `Composer` 里加了 `role="status" aria-live="polite" aria-atomic="true"` 的隐藏区域，
   只播报阶段（「正在生成回答，可按停止按钮中断」），不播报 token。
   实测：节点存在、属性正确、空闲时文本为空、以 `sr-only` 隐藏 ✅

**测量陷阱**：内嵌浏览器 `document.hasFocus() === false` 时 `:focus` 伪类不匹配，
所以 `sr-only focus:not-sr-only` 的可见态读起来永远是 1px——不是样式没生效
（编译产物里 `.focus\:fixed`、`.focus\:not-sr-only` 都在），是测不到。
另外 `element.click()` 不会移动焦点，测「归还焦点」必须先 `el.focus()` 再 click。

### 5.8 弹层重构为 portal + inert（同日第三次，取代上面第 2 条的实现）

`useFocusTrap` + `useInertShell` 两个 hook 并存在顺序陷阱上反复失败，最终合并成
`hooks/useDialogFocus.ts`：一个 layout effect 内按固定顺序做完
**捕获 opener → 给 `#app-shell` 加 inert/aria-hidden → 圈定 Tab → 清理时先摘 inert 再归还焦点**；
`Modal` 拆成外层 `Modal`（只管 open 判断）+ 内层 `ModalPanel`（`createPortal` 到 `document.body`），
命令面板同样 portal。旧的 `useFocusTrap.ts` / `useDialogA11y.ts` 已删除。

必须写在一个 effect 体内的原因：拆开时清理顺序跟声明顺序绑定，很容易变成「外壳还带着 inert 就 focus()」，
浏览器会直接忽略那次聚焦；而 opener 的捕获又必须早于 inert（inert 一挂上，触发按钮会被强制 blur，
捕获到的就是 `<body>`）。

实测（同一环境）：弹层位于外壳子树之外 ✅、`inert`+`aria-hidden` 生效与摘除 ✅、
背景元素聚焦被拒且焦点保持在弹层内 ✅、Tab 4/4 留在弹层内 ✅、Esc 关闭 ✅、
命令面板关闭后焦点归还侧栏触发按钮 ✅、打开时焦点落在面板输入框 ✅。
Modal 的焦点归还仍测不出来（activeElement 停在 `<body>`）：已排除 inert 顺序、触发按钮重挂载
（`sameNode: true` / `isConnected: true`）、StrictMode 双跑污染（改为每实例只捕获一次后面板侧恢复正常）。
最后一次同步归还是生效的（关闭瞬间 `activeElement` 确实是 BUTTON），随后被 React 19 的删除后焦点恢复抢回 `<body>`；
补的宏任务重试在面板侧有效、Modal 侧无效。剩下唯一差异是本标签页 `document.hasFocus() === false`，
没有真实聚焦环境无法证实，所以这一条仍标注为未验证。

## 6. 仍然没做

- 侧栏折叠（把 w-60 收成图标栏）没做：分区里会话列表是主体内容，折叠后列表无处安放，需要先定产品意图。
- ~~列表**进入**动画只有 `.anim-stagger` 用于首屏，删除以外的插入场景没有逐项动画。~~ 已由 §9 收口。- `@/` 路径别名仍未配置——当前目录只有一层 `../`，收益低于全量改 import 的 diff 噪音。
- 字体分发决策仍未定：`index.css` 里是诚实的本地优先栈（LXGW WenKai 等），未内置字重文件。
- 会话事实源迁移（含 IDOR 与配额）等后端第二批契约变更。
- 弹层焦点归还：portal + `inert` 已落地（见 5.8），背景不再可能被 Tab 出去；只剩 Modal 关闭后的归还在本环境无法验证。

## 7. 重构后的回归核查（同日第四次）

弹层改成 portal + inert 之后重跑了一遍真实页面，顺带补掉一个层级不一致：

- **集合层缺搜索**：知识库列表和文档列表都有搜索框，中间的集合层没有（`useMemo` 依赖里根本没有 query）。
  现已补上按集合名与描述的过滤、`没有匹配的集合` 空态（过滤时不显示「新建集合」按钮）、分页 total 跟随过滤结果。
  实测：`faman` 命中 1 行 → 乱串 0 行且出现空态 → 清空恢复 1 行 ✅；五个列表的空态现在都区分「没数据」与「没匹配」。
- **知识库控制台**：`[aria-current="page"]` 恒为 1 ✅，4 个导航项，9 行知识库全部 `tabindex="0"` 可键盘进入，
  Enter 下钻到 `/admin/vector/6`，面包屑 `知识库 faman`，标题 `知识库 · Ametrine` ✅。
- **组织与权限（租户 + 用户融合页）**：成员 7 行、租户 6 行，两个 tab 带计数且切换正确；
  在成员行上按 Enter 打开详情弹层（portal 在壳外、外壳 inert、Esc 关闭后 inert 清除）✅。
- **新建集合弹层**：打开时焦点进入、2 个输入框、Esc 关闭、inert 摘除 ✅（只验证交互，未提交，避免造真实数据）。

核查中修正了一次误判：我最初用 `input[placeholder*="搜索"]` 取「页面搜索框」，实际命中了侧栏的「搜索会话」，
于是把一个正常的空态读成了缺陷——页面级控件要用 `main` 作用域和精确 placeholder 选择。
另一次是 `[role=tab]:last-of-type` 点到了侧栏的模式 tab 而非页面 tab，导致读到 0 行；同样是我的选择器问题。

## 8. RAG 引用卡片的两处语义修正

引用面板此前已经做对了分级（高/中/低相关、分数条、低分警告、诚实说明「后端不给 document_id 所以不承诺回溯」），
但有两处会误导：

1. **文件路径被排成了「引用原文」的样子**：`ref.source` 是来源文件路径，却渲染在带边框、带底色、
   `line-clamp-3` 的块里——视觉上与正文引文块同构，用户会把它读成命中的段落。后端目前不给命中片段
   （见后端评估 §2.5），所以正确做法是承认它是路径：文件图标 + 单行截断 + `title` 悬浮全文，去掉边框与底色。
   实测：该 `<span>` 为 `overflow=hidden / text-overflow=ellipsis / white-space=nowrap` 且带 `title`，
   父级 `border-top-width=0px`、`background=rgba(0,0,0,0)` ✅；引用区里唯一还带边框+底色的块只剩注意状态提示。
2. **「没有引用」没有任何信号**：原来只有 `references?.length` 为正才渲染面板，零引用时用户看到的是一段
   读起来像有据、实际无据的回答。现在生成结束后若 `references` 是空数组，显示一条克制的说明。
   判定放在 `!streaming` 之后——流式途中 `references` 还是 `undefined`，不误报；
   老消息没有这个字段也不报（只有新产生的回答会被标记）。
   实测：3 条引用（72% / 41% / 8%，低分那条出现「相关性较低」提示）与空引用消息分别渲染正确 ✅

顺带补了列的语义：`<ol aria-label="引用来源列表">`、序号方块 `aria-hidden`、标题前加 `sr-only` 的「第 n 条引用：」，
读屏不再念出一个孤零零的数字。

注：本轮无法端到端验证流式与真实引用，因为 Xinference 没加载 `XINFERENCE_LLM_MODEL_ID` 对应的模型
（`src/client.py:70-71`）；以上是注入已完成的助手消息后，对渲染路径做的实测。

## 9. 入场动效：只给「刚出现的那一条」

新增 `.anim-rise`（复用既有 `fade-rise` 关键帧，时长 `--dur-base`），用在两处：

- **消息流**：`MessageList` 用惰性 state 记住挂载时的消息数作基准，`i >= baseline` 的行才加 `.anim-rise`。
  这样切进一个长历史会话不会整屏升起，只有你新发的那条会入场。基准值必须用 state 而不是 `useRef`：
  渲染期读 `ref.current` 被 `react-hooks/refs` 禁止，我第一版就是踩在这里被 lint 挡下。
  会话切换时 `<main key={pathname}>` 重挂载，基准值天然重置，不需要额外清理逻辑。
- **侧栏会话列表**：分组 `<ul>` 用已有的 `.anim-stagger`（前 6 项 24ms 递进），新建会话时该行入场，
  与删除时的收起动画形成完整的进出对称。
- 错误提示条补 `.anim-fade`，不再凭空出现。

实测（发送一条消息，后端按预期 500 走失败分支）：
挂载时两条历史消息 `animation-name: none` ✅ → 新发的第三条为 `fade-rise` ✅；
错误条 `fade-in` ✅ 且文案可行动（「后端处理失败，通常是模型尚未加载或向量库不可用。可检查 Xinference 与 Milvus 是否就绪后重试」）；
侧栏行 `fade-rise` ✅；发送后输入框即时清空 ✅。

`prefers-reduced-motion` 的全局开关已覆盖 `animation`，所以这些入场动效在该模式下自然失效，
不需要像删除动画那样在 JS 里判断（删除有计时器才必须判）。

## 10. 反馈状态的播报与错误文案

- **播报缺失**：`Loading` 加 `role="status"`、`ErrorState` 与 `ErrorNotice` 与登录页错误条加 `role="alert"`、
  `EmptyState` 加 `role="status"`（搜索无结果时会被读出来）。此前这些都是「视觉上出现、读屏里静默」。
  实测：以错误凭据登录 → 页面上出现 `[role=alert]` 且被正确朗读定位 ✅
- **`Toggle` 与 `VoiceInput` 检查后确认无需改动**：前者本来就是真 `<input type=checkbox>`（状态天然可读），
  后者的录音按钮带随秒数变化的 `aria-label`；再加一个每秒播报的 live region 只会变成噪音。不为了「看起来做了事」而加。
- **错误文案不再漏英文**：`apiClient` 的非 2xx 分支原来只取信封里的 `message`，遇到 FastAPI 校验形状
  `{detail}` 就取不到；现在一次读取 body、兼容 `message`/`detail` 两种形状，并且只在值是字符串时采用
  （422 的 `detail` 是数组，之前会变成 `[object Object]`）。
  登录失败统一成「用户名或密码不正确」——后端会区分「用户不存在」与「密码错误」，
  前端不把这个差别透出去，等于关掉一半枚举面。注册冲突映射成「该用户名已经被注册，换一个试试」。
  实测两条文案都生效 ✅（第一次映射漏掉了后端的 "already taken" 措辞，补进正则后才对，见 §11 教训）。
- **顺手清掉的两处**：`useLogin.onSuccess` 里 `console.log('登录返回的数据:', data)` 会把令牌打进控制台；
  `useCurrentUser` 里 `message.includes('401') || includes('过期')` 的字符串嗅探 + `window.location.href` 整页刷新
  一并删除——`apiClient` 在 401 时已经 `logout()`，`enabled: !!token` 立刻让查询失效，跳转交给 ProtectedRoute。

## 11. 顺带确认的后端事实（已并入 backend-evaluation §三）
`GET /api/user/all` **不带任何凭据**就返回全部用户名（实测拿到 `root`、`admin`、`test-root` 等 7 个）。
和 `/api/auth` 区分「用户不存在 / 密码错误」连起来，就是一条完整的账号枚举链——
这也是本轮把登录错误统一成一句话的原因（前端至少不再把差别透出去）。

## 12. 页签键盘语义（做成了）与 sticky 表头（测出来不成立，已回退）

**页签**：`role="tablist"` 会向读屏承诺「方向键可切换」，而此前两处页签（Settings 的 偏好/配额/认知、
组织与权限的 成员/租户、侧栏的 对话/检索）都只有 `aria-selected` + 点击，方向键完全无效，
且每个页签都可 Tab 停留。新增 `hooks/useRovingTabs.ts`：方向键 / Home / End 移动焦点并选中（自动激活，
因为这些页签切的都是纯客户端视图），配合 roving `tabIndex`（只有当前项可 Tab 停留）。
`Tabs` 与侧栏模式切换共用它，顺手把侧栏那段内联在 `onClick` 里的导航逻辑抽成 `switchMode`。
实测：Tab 停留点数前后都是 1 ✅；`→` 从「偏好设置」到「用量配额」，焦点与 `aria-selected` 同步 ✅；
`End` 跳到「认知配置」✅；侧栏 `→` 切到「检索」并导航到 `/rag/...` ✅。

**sticky 表头：加了，量了，回退了。** 给 `.a-table thead th` 加 `position: sticky; top: 0`（并把
`border-collapse` 改 `separate` 以便边框跟着停住）之后实测：把 `main.scrollTop` 设成 400，表头相对
`main` 顶部的偏移是 161px —— 也就是说它根本没钉住，跟着内容一起滚走了。祖先链给出原因：
Panel 的 `<section class="a-card overflow-hidden">` 才是最近的裁剪祖先（那个 `overflow-hidden` 是必需的，
否则表格行背景会从圆角处戳出卡片），sticky 于是被钉在卡片自己身上，而卡片本身不滚。
能救的做法是给表格容器自己开 `max-h + overflow-auto`，但 `PAGE_SIZE=20` 下表格几乎不会超出视口，
换来的是嵌套滚动条——更糟。所以整段回退，只在 CSS 里留了一行「为什么这里不做 sticky」的注释。
留着不生效的样式比没有样式更坏。

**顺带**：`Pagination` 现在是 `<nav aria-label="分页">`，计数段落带 `role="status"`（翻页后会被读出来）。
本次数据量下（9 个知识库、单页）分页不渲染，所以这条只做到「代码与结构正确」，没有跑到实拍。

**清理**：本轮为了验证建的会话（后端真实 `Conversation` 两行）已通过 `DELETE /api/conversation/{id}` 删除，
账号（uid 20）也已删除。**遗留**：前几轮在 uid 11/12/13/15/16/17/18 下自动创建的空会话没有清理入口——
`/conversation/list` 是按当前用户过滤的，而那些用户已删除，这些行成了孤儿。要么之后用 SQL 一次性清掉，
要么等第二批契约改动时加上「删号即删会话」的级联。

## 13. 测试基建（此前一个测试都没有）

`pnpm add -D vitest`（走 dev.sh 同一套 pnpm，+18 包，2 秒完成，仅动 `package.json` 与 `pnpm-lock.yaml`），
脚本补了 `test` / `test:watch`，并把测试并入 `check`：`tsc -b && eslint . && vitest run`。
现在 `npm run check` 的退出码 0 意味着类型、lint、行为三件事同时成立（之前我只看 `| tail` 的输出，
被管道吞掉过一次 lint 失败，现在一律显式取 `$?`）。

22 个用例，优先覆盖本轮和上轮**真实修过的 bug**，而不是凑覆盖率：
- `sessionStore.test.ts`：删掉当前检索会话不得跳到「对话」会话、有同模式后继时选后继、删非当前会话不动 `currentSessionId`、
  `renameSession` 只改目标项。这是 §3.2 那个 bug 的回归锁。
- `pageTitles.test.ts`：九个路由的标题映射 + 未知路径不猜标题。
- `chat.test.ts`：`describeStatus` 的每种状态码都必须给出含关键词的中文指引（401→登录、403→权限、
  404→不存在、500→重试、502/504→不可用），未知码至少带出状态码本身——这些文案是失败时用户唯一的指引。

写测试的过程本身抓到两件事：
1. **实现缺陷**：`pageTitleForPath` 用的是裸 `startsWith`，`/chats` 会被认成「对话」页；改成按路径段匹配
   （`p === prefix || p.startsWith(prefix + "/")`）。这是先写断言才发现的，光看代码时我没意识到。
2. **两处测试自身的错**：`describeStatus` 的关键词是我凭记忆写的（500 期望「服务」、504 期望「超时」），
   实际文案不含这两个词——先判定是实现问题再改断言前，我核对了文案原文，确认实现在语义上更准确，才改测试；
   另外 zustand 的默认存储要先探测 `window` 才看 `localStorage`，只桩 `localStorage` 会一直刷
   `storage is currently unavailable` 并静默跳过写盘，补上 `window` 桩后噪音消失。

局限说清楚：跑在 node 环境（没装 jsdom），所以只覆盖纯逻辑与 store，不含渲染与交互；
组件层的行为目前仍靠我在真实 dev server 上用 `evaluate_script` 实测（§5、§9、§12）。
`createSession` 会发网络请求，测试里一律用 `setState` 直接播种，不依赖后端。

## 14. 深链指向已删除资源时不再静默退回上一级

复核知识库控制台三层状态时发现的真实缺陷：路由解析是
`const database = dbId ? databases.find(...) : null` 配 `{!database && <DatabaseList/>}`，
于是访问 `/admin/vector/999`（库已删除、或属于别的租户）时页面**悄悄渲染成第一层列表**，
而地址栏仍写着 `/admin/vector/999`；`/admin/vector/6/99999` 同样退回集合列表；
`dbId` 不是数字时也一样（`Number("abc") = NaN` → 静默退回）。
这正是「链接看起来坏了、又说不清坏在哪」的那类体验。

做法：解析抽成纯函数 `utils/drilldown.ts`，结果为
`databases` / `collections` / `documents` / `database-missing` / `collection-missing` 五态，
缺失分支带上 id 与所属库以便给返回链接；页面按结果渲染明确的缺失态。
顺带删掉 `DatabaseList` 的 `loading` prop —— 根组件已在 `isLoading` 时提前返回，
该 prop 恒为 false，`loading ? <Loading/> :` 是死分支。

实测（真实浏览器）：
- `/admin/vector/999` → 「这个知识库不存在」+「编号 999 的知识库可能已被删除，或属于另一个租户。」+ 返回链接 ✅
- 点返回 → `/admin/vector`、9 行列表 ✅；行上按 Enter → `/admin/vector/6`、面包屑「知识库 faman」、标题「知识库 · Ametrine」✅
- 集合缺失分支由单测覆盖（8 例，含跨库 colId、非数字 id、空集合的库）

测试累计 30 个，`npm run check` 退出码 0（类型 + lint + vitest 三连）。

## 15. 分页只有一份实现，页脚不可能再和表格内容吵架

`AdminVector` 与 `AdminAccess` 各有一份 `usePaged`，同名不同义：

| 位置 | 旧实现 | 后果 |
| --- | --- | --- |
| `AdminAccess.tsx:57` | `Math.min(page, pages)` 夹取 | 正常 |
| `AdminVector.tsx:43` | 直接 `rows.slice((page-1)*20)` | 越界页 → 空表 + 页脚「第 5 / 1 页」 |

触发路径很日常：在第 3 页搜索把结果筛到 1 页、或删掉当前页仅剩的一条。
做法：抽 `utils/pagination.ts` 的纯函数 `paginate(rows, page, pageSize?)`，
返回 `{ items, page, pages, total, pageSize, offset }`（page 已夹取、pages 至少 1）；
`<Pagination>` 的 props 从 `page/pageSize/total` 三个可各自漂移的数字改成只吃 `paged` 一个对象，
于是页脚的页码与表格切片必然同源。分块编号改用 `paged.offset + i + 1`。
`setPage(1)` 除了搜索框，角色筛选也补上了（以前靠夹取兜底，现在两处都显式回到第一页）。

单测 7 例：越界夹取、恰好整除不多出空页、`page` 为 0/负数/NaN、空结果集、自定义 pageSize、末项序号。
**未做**：真实数据里最大的表只有 9 行（9 库 / 6 文档 / 每文档 ≤2 分块），页脚在当前数据集下不会出现，
所以 >20 行的路径只有单测覆盖，没有浏览器实测。

## 16. 路由守卫不再因为「后端在重启」把用户赶出去

`ProtectedRoute` 旧代码是 `if (!isAuthenticated || isError) return <Navigate to="/login" replace/>`。
`isError` 来自 `useCurrentUser()`，而 `apiClient` 只在 **401** 时才 `logout()`（`client.ts:46`），
所以这里的 `isError` 分支实际接管的是「网络抖了 / 后端 500 / Xinference 超时」：
token 依然有效，却把人踢回登录页，并且丢掉来路深链。
顺带两个问题：`/user/me` 在飞的时候直接放行 `Outlet`，管理员菜单和角色徽章会先按「非管理员」渲染再补上；
`Navigate` 不带 `state`，登录后回不到原来要去的深链。

改法：
- 未登录 → `Navigate to="/login" state={{ from: pathname + search }}`
- `isPending` → `<Loading label="正在确认身份…">`（不再闪未授权态）
- `isError` 但仍登录 → `<ErrorState title="暂时读不到你的账号信息" onRetry={refetch}/>`，原地重试
- `Login` 用 `utils/redirect.ts` 的 `safeRedirect(from)` 决定去向，并把来路显示成副标题
- `safeRedirect` 把 `from` 当外部输入处理：只接受站内路径，拒 `//evil.com`、`/\evil.com`、绝对 URL、
  非字符串，以及 `/login`、`/register` 自身（避免自我跳转）

实测（真实浏览器，登录态为过期 token）：`/admin/access` → `/login`，
`history.state.usr = { from: "/admin/access" }`，副标题渲染「登录后返回「组织与权限」」，
`document.title` 为「登录 · Ametrine」✅
**未做**：「登录后跳回深链」需要真实凭证，我没有你的账号密码，这一跳只由 `safeRedirect` 的 5 个单测背书；
`isError` 的非 401 分支同理（无法在不改后端、不注入脚本的前提下稳定复现）。

测试累计 42 个（6 文件），`npm run check` 与 `vite build` 退出码均 0；
`AdminVector` 14.55 kB / `AdminAccess` 14.41 kB / gzip ≈ 4.7 kB。

## 17. 骨架屏从死代码变成加载态的默认形状；reduced-motion 少了的一行

一轮「导出符号 / CSS 类是否还有人用」的静态扫描里跳出来一个：`.skeleton` 定义在
`index.css`（shimmer 渐变动画），全项目 0 引用——动效层建好了却没人用。
原因在 `DataTable`：`if (loading) return <Loading/>`，整张表（表头、列宽、面板高度）在加载时
全部消失，数据到位再一次性撑开。改成加载时保留真实 `<thead>`、`<tbody>` 里放四行错落宽度的
`.skeleton` 方块，`aria-busy="true"` + `<caption class="sr-only">正在加载数据…</caption>`：
表框不跳、读屏有播报、`.skeleton` 变成有职责的类。表头抽成内部 `TableHead`，两个分支共用。

顺带一个我自己留下的 a11y bug：`prefers-reduced-motion` 的总开关只写了
`animation-duration: 0.01ms !important`，没写 `animation-iteration-count: 1`。
对一次性入场动画没问题，但 infinite 动画（骨架屏 shimmer、spinner）会以 0.01ms 一轮的速度**继续循环**，
那不是「减弱动效」而是高频闪烁——正是 WCAG 2.3.1 要防的东西。补上 `animation-iteration-count: 1 !important`
和 `scroll-behavior: auto`。

实测：构建产物 CSS 里 `prefers-reduced-motion:reduce` 块现在含 `animation-iteration-count:1!important`；
`skeleton` 字符串出现在 `dist/assets/index-*.js`（类名随组件打包，不再是孤立样式）。

## 18. 快速上手引导：自己拼的遮罩换成共用 Modal，并且真的能走完

`OnboardingTour` 是全app唯一没走弹层协议的对话框：手写 `fixed inset-0` + `aria-modal="true"`，
但焦点从没进过对话框、背景照旧可 Tab、Esc 关掉、没有入场动效。
它偏偏是新用户看到的第一个弹窗——可达性最差的地方在入门引导上。

改动与理由：
- 外壳改用 `Modal`（portal + 焦点移入 + 背景 `inert` + Esc + `.anim-pop`），组件自己少 40 行壳
- 「跳过引导」和走完最后一步才写 `ametrine_onboarding_done`；遮罩点击 / Esc 只是本次不看。
  以前 backdrop 的 `onClick={onClose}` 直接写永久标记，**误触一次就永远失去引导**
- 写标记的 `localStorage.setItem` 包了 try/catch（隐私模式会抛），并额外用模块级
  `tourHidden` 保证「关掉这一轮就别再糊脸」，刷新后才重新出现
- 流程本身有个原有缺陷：`{current.action && !last ? <Link> : <button 下一步>}`——
  三步里两步带链接，于是第 1 步只能点走（没有下一步）、第 3 步的链接永远不渲染。
  现在「去哪儿」作为正文里的行内链接，页脚只留 跳过 / 上一步 / 下一步|开始使用

实测（真实浏览器，临时账号 uid 22，验完已删）：
- 打开即 `aria-label="快速上手 · 创建知识库"`、`parentElement === body`、
  `#app-shell` 同时带 `inert` 与 `aria-hidden="true"`、`document.activeElement` 在对话框内 ✅
- Esc：对话框消失、`inert` 解除、`ametrine_onboarding_done` **仍为 null**（关掉≠看完）✅；
  离开 `/dashboard` 再回来不再出现 ✅
- 整轮走完：step1 `跳过引导|下一步` + 行内「前往知识库管理」→ step2 `跳过|上一步|下一步`
  → step3 `跳过|上一步|开始使用`，点击后关闭、标记写成 `"true"`、`inert` 解除 ✅
- 同一次登录还顺带证实了上一轮**只能靠推理**的那条：`/login` 带着 `state.from=/admin/access` 登录成功后
  跳去该深链，非管理员被守卫接住落到 `/403` ✅

清理：`/rag` 那次访问创建了 2 条 Conversation，已 `DELETE /api/conversation/{id}` 清成 0 条；
用户 22 已删并验证 `/api/user/22` 返回 404；浏览器 `auth-storage` 移除、
`ametrine_onboarding_done` 恢复成测试前的 `"true"`。

## 19. 知识库控制台的加载态改成按 URL 深度给骨架（顺带纠正一个「假绿」）

`AdminVector` 根组件在 `isLoading` 时整页换成一个居中 spinner。除了 §17 说的塌陷+下跳，
还有一个更严重的隐患：如果把 early return 直接删掉让页面照常渲染，第一帧 `databases` 还是空数组，
`resolveDrilldown` 会把一条**合法深链**判成 `database-missing`，用户看到「这个知识库不存在」。

做法：`ConsoleSkeleton` 按 URL 深度（`colId?2:dbId?1:0`）渲染同一副骨架——页头两条骨架条、
Panel（标题与工具条位置各一条骨架）、真实 `<thead>` + `DataTable loading` 的骨架行。
三级各自复刻真实列名与列宽（知识库/租户/集合、集合/文档/创建时间、文档/索引状态/分块/上传时间）。
`SKELETON_LEVELS` 用 `Record<0|1|2, …>` 而不是数组，索引结果在类型上必然存在，
不需要 `?? ` 兜底或 `!`。顺带把 `Panel.title` 从 `string` 放宽到 `ReactNode`（骨架条要能当标题用）。

实测（真实浏览器，临时账号 uid 23，验完已删；给 `/api/relation/database/all` 注入 2.5s 延迟）：
直接以 `/admin/vector/6` 登录后落地，采样时间线只有三个状态：
| 时刻 | 骨架块 | 表头 | tbody 行 | aria-busy | 误报缺失 |
| --- | --- | --- | --- | --- | --- |
| 1008ms | 0 | — | 0 | false | 否 |
| 2001ms | **17** | 集合/文档/创建时间 | 4 | **true** | **否** |
| 5000ms | 0 | 集合/文档/创建时间（同一副） | 1（真实数据） | false | 否 |

表头在加载前后完全一致、只有行被替换，正是「形状不变」的目的；面包屑最终为「知识库 faman」。
`/admin/vector`（深度 0）同样验到骨架表头为 知识库/租户/集合。
本次未产生 Conversation（0 条），账号删除后 `/api/user/23` 返回 404。

## 20. 待修（已定位、未动手）：光访问 `/chat`、`/rag` 就会在后端建会话

审计时用一次性账号只做路由切换、一个字没输入，仍留下 2 条 `Conversation` 行
（删除账号前已 `DELETE /api/conversation/{id}` 清掉，账号本身也已删）。这就是「库里莫名多出空会话」的来源。

唯一起因点：`hooks/useSessionMessages.ts:49-57` —— URL 没有 `convId` 且当前模式没有可复用会话时，
effect 直接 `createSession(mode)` 并把 URL replace 成新 ID。`createSession`
（`stores/sessionStore.ts:48-75`）第一步就是 `POST /api/conversation/create`。
其余三个 `createSession` 调用点（`AppLayout.tsx:261` 新建按钮、`CommandPalette.tsx:76,86`）
都是用户主动行为，不该改。

两条可选路径，按代价从小到大：
1. **本地先建、发送时才落库**：`createSession` 增加「仅本地」模式（直接 `crypto.randomUUID()`、不打后端），
   首条消息发送时再补 `conversationAPI.create`。风险取决于后端是否会在 `addMessage` 里
   用 `ensure_conversation` 隐式建行——若会，本地 ID 反而会让会话**没有归属用户**地落库
   （`ensure_conversation` 未写 `user_id` 是已记录的后端缺陷），必须先确认后端的实际行为再动。
2. **路由不自动绑定会话**：`/chat`、`/rag` 裸路径保持「未选会话」的空状态（输入框可用、
   `currentSessionId = null`），第一次发送时才 `createSession` 并 replace URL。
   代价是要同时改 `Chat.tsx` / `RAGChat.tsx` 的发送分支（它们目前假定 `currentSessionId` 存在），
   以及 `beginTurn` 之前必须拿到 ID——这是改动面更大但语义更干净的做法。

方向 2 是正确答案，但它碰的是这个应用的主路径（发消息），一回合内改不完也验不彻底，
所以留到获得继续许可时单独做；不要用「先建本地会话」这种半刀切来图快。

**另一个必须记下的纠正**：我之前多次报的「`npm run check` 退出码 0」里，有两次是在存在类型错误的情况下
打印出 0 的。用脚本文件在 WSL 内重跑同一命令证明：`npm run check` 遇到类型错误确实返回 2、干净时返回 0，
`tsc -b` 连续三次都返回 2 ——**说谎的是我的调用方式**（Git Bash → `wsl.exe -c` 的嵌套引号把 `$?` 弄错了），
不是门禁。因此本轮同时补做了真实门禁：`tsc` 抓到 2 个类型错误（`Panel.title` 是 `string`、
`SKELETON_LEVELS[depth]` 可能 undefined），都已修；最终 `GATE_EXIT=0`、6 个测试文件全绿、`vite build` 0。
