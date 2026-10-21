# AGENTS.md

本文档用于约束本项目中的 AI / 自动化开发行为。开发时优先遵循本文件，其次遵循用户当前消息。

## 基本原则

- 先读现有代码，再动手修改，优先沿用项目已有结构和写法。
- 写代码保持最少行数，能简单实现就不要引入复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，不要手写底层实现，除非用户明确要求或项目已有实现必须沿用。
- 不要为了“兼容更多场景”写大量分支，只实现当前明确需要的功能。
- 项目已有公开安装包，仓库整理不得改变现有应用身份、用户数据路径或更新通道；涉及存储结构调整时遵循下方数据迁移规则。
- 每次写完代码，不需要检查语法，不需要执行构建，用户会自己做。
- 不要改无关文件，不要顺手重构。
- 如果工作区已有用户改动，不要回滚，不要覆盖；只在必要范围内追加修改。

## 反复提醒沉淀

- 如果开发过程中总是遇到某个问题，或者用户反复提醒同一个注意事项，需要把该注意事项补充到本文件。
- 补充时写成明确、可执行的规则，避免只写模糊描述。
- 新规则应放到最相关的章节；找不到合适章节时放到“项目注意事项”。

## 前端规范

- 品牌为「四季画布 FourJ Canvas」。设计令牌唯一源是 `web/src/lib/design-tokens.ts`；antd 主题在 `web/src/lib/app-theme.ts` 派生，画布主题在 `web/src/lib/canvas-theme.ts` 派生，`styles/globals.css` 的 shadcn CSS 变量与令牌手动同步（改色两边一起改）。设计系统权威文档：`docs/content/docs/development/design-system.zh-CN.mdx`，改前端视觉前先读它。
- 业务代码里产品名写「四季画布」（英文 FourJ Canvas），不要硬编码「无限画布」品牌名；画布项目默认名用「未命名画布」。
- 前端使用 Vite、React、React Router、TypeScript、Ant Design、Tailwind、Zustand。
- 编写 Ant Design 相关代码时，参考 https://ant.design/llms-full.txt 理解组件 API、示例和设计规范，并优先结合项目当前 antd 版本与既有写法。
- 外部服务请求统一放在 `web/src/services/api/`，由浏览器前端直连，不假设存在项目后端。
- 全局或跨页面状态优先放在 `web/src/stores/`。
- 已经放在全局 store 或全局 hook 中的状态/动作，组件需要时直接使用对应 store/hook，不要为了“纯组件”层层透传 props；避免一个组件传递过多参数。
- 全局组件、全局常量、全局配置等全局性质的内容不要作为 props 或参数层层传递；哪里需要就在哪里直接从对应全局入口获取。
- 多个页面重复出现的 UI 副作用动作，例如复制文本并提示、下载并提示、统一确认弹窗，优先抽成 `web/src/hooks/` 下的全局 hook；不要放进 store，除非它确实是需要共享/订阅的状态。
- 路由页面放在 `web/src/pages/`，页面布局放在 `web/src/layouts/`，路由配置放在 `web/src/router.tsx`。
- 画布页面放在 `web/src/pages/canvas/`，画布组件放在 `web/src/components/canvas/`，画布状态放在 `web/src/stores/canvas/`，画布工具函数放在 `web/src/lib/canvas/`。
- 页面按目录组织，例如 `web/src/pages/image/index.tsx`；页面里只有一个主业务组件时直接写在对应页面入口中，不要单独拆 `Manager` 组件再传一堆 props。
- 不要新增只做简单转发的组件，例如只 `return <X>{children}</X>` 或只换个名字透传 props；直接在使用处使用真实组件或把逻辑写进当前文件。
- 页面私有 hook 放在对应页面目录下，例如 `admin/assets/use-admin-assets.ts`；只有多个页面真实复用的 hook 才放到外层 `hooks/`。
- 管理后台页面私有组件放到各自页面目录的 `components/` 下，例如 `admin/assets/components/`、`admin/prompts/components/`；不要为了单页面使用放到 `admin/components/` 共享目录。
- 管理后台主题、背景、卡片阴影、表格配色等统一在 `web/src/lib/app-theme.ts`、`AppProviders` 或必要的全局 CSS 作用域中配置；页面私有组件不要自己写 `dark ? ...` 主题分支。
- Ant Design 的 Dropdown、Menu、Select、Cascader、TreeSelect 等弹层背景、悬停态和选中态颜色统一通过 `web/src/lib/app-theme.ts` 的全局 Alias Token 与组件 Token 配置；不要在业务组件内为单个弹层覆盖颜色。
- 组件优先使用函数组件和现有 hooks，不新增大型状态管理方案。
- UI 图标优先使用 `lucide-react` 或项目已经使用的 Ant Design 图标。
- 页面文案保持中文。
- 全站字体以清晰锐利为首要验收标准：普通正文、标签和控件默认使用真实 400 字重，选中/强调使用 500，600 仅用于明确的强强调；不要把 `font-medium` 与 `font-semibold` 映射成同一字重，不要给中文正文、标题或控件统一添加正/负字距。英文大写品牌元信息的字距也应保持克制，通常不超过 `0.08em`。
- 页面与导航动效不得给文字添加模糊、滤镜或阴影；临时位移动画结束后必须移除 `transform` 和动画效果，避免文字长期停留在合成层而影响锐利度。
- 全站动效统一遵循「四季流韵」：整体应优雅、轻微黏滞但不拖沓；朱砂只表达悬停探索，点击反馈从真实指针位置原位扩散并沉淀为静止暖金确认，页面切换按导航顺序可逆且从哪来回哪去。禁止机械贴手、廉价闪光、细丝长尾、太阳状大光斑、跨选项游走的金色块，以及为不同页面重复发明互不一致的动效。
- 不要在组件里堆太多无关逻辑；复杂逻辑优先抽成同目录工具函数或小组件。
- 样式优先由组件自己管理；组件私有样式优先使用 Tailwind className 或少量内联 style，不要为单个组件新增大量全局 CSS。
- 全局 CSS 只放基础变量、全局重置、跨页面通用样式和少量第三方组件必要覆盖；不要在 `globals.css` 堆页面私有样式。
- 代码尽量短小直接，少拆不必要组件，少做多层 props 传递，避免为了抽象堆出更多代码。
- 前端业务数据需要浏览器本地持久化时，默认使用 `localforage`；`localStorage` 只用于极小的简单配置，不要用来保存业务列表、生成记录、图片、base64 或大 JSON。

## 画布 UI 规范

- 做 canvas 前端 UI 时必须遵循当前画布主题。
- 优先使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token。
- 不要硬编码黑白、stone、slate 等颜色导致浅色/深色主题不一致。
- 新增画布按钮、弹窗、浮层时，尽量复用已有工具栏、节点面板、Modal 的视觉风格。
- 画布顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景，融入整体背景，弱化按钮感，仅保留轻微 hover 反馈，保持简洁现代、低视觉重量。
- 左侧画布面板等列表里的节点/元素缩略图容器，非图片类型（文本、配置、视频、音频等）不要使用 `theme.node.fill` 这类灰色背景，图标直接无背景展示，尽量不要给多余底色，保持干净。
- 画布内的操作按钮（如面板里的「添加」「导出」「选择」等）默认用扁平无底色样式：透明背景、仅 `hover:bg-black/5 dark:hover:bg-white/10` 轻微反馈，靠图标+文字表达，不要用 `theme.toolbar.activeBg` 或 `theme.node.fill` 之类的灰色作为按钮填充底色。工具栏/列表「选中态」用 `theme.toolbar.activeBg`（中性浅底）表达状态，不要当普通装饰底色；朱砂品牌色只用于品牌元素与画布节点选中描边（`theme.canvas.selectionStroke`/`theme.node.activeStroke`），不要大面积当按钮底色。
- 图片节点尺寸逻辑要尊重原始比例，除非功能明确要求自由变形。
- 批量生成、多图展示、助手面板等画布交互要尽量简洁，不要占用过多画布空间。
- 普通用户界面的画布只保留一个内置「对话」入口；不得重新暴露外部 Agent、Codex/MCP 切换、连接状态或额外安装流程，除非用户明确改变产品要求。旧桥接代码和开发文档可以保留，但不能进入默认用户流程。
- 首页指针字纹固定只使用 `FOURJ` 铺满首屏；阴刻底纹、闲置流光与指针阳刻显影必须共享完全相同的行列、字号和坐标，只允许蒙版移动，不得对任一文字层单独缩放、平移或改变 inset。无操作时显示克制的闲置流光，指针移动时切换为局部显影；首页桌面侧栏使用左侧不可见热区浮层唤出，不得保留提示线或色块；首屏品牌文字不可拖选且简介不得出现行首孤立标点。

## 文档规范

- README 保持简洁，只放项目介绍、核心功能、快速开始和文档入口。
- `docs/index.md` 放给 AI 使用的文档索引，不要再放到 `docs/content/docs/` 内容目录里。
- 详细功能介绍写到 `docs/content/docs/overview/features.mdx`。
- 后续待办写到 `docs/content/docs/progress/todo.mdx`。
- 已实现但还需要用户测试确认的事项写到 `docs/content/docs/progress/pending-test.mdx`。
- `docs/content/docs/progress/pending-test.mdx` 用来记录这个版本实际做了哪些可测试变更；`CHANGELOG.md` 的 `Unreleased` 只保留对这些变更的版本级归纳，避免逐条照搬实现细节。
- 每次重大改动（新增/调整/删除功能、接口或工具，影响用户可感知行为）完成后，都要在 `CHANGELOG.md` 的 `Unreleased` 追加一条记录，按 `[新增]` / `[调整]` / `[修复]` / `[优化]` 前缀分类，用一句中文归纳；纯内部重构、格式化、无用户可感知影响的小改动可不记。
- 每次 todo 事项完成后，先从 `docs/content/docs/progress/todo.mdx` 移到 `docs/content/docs/progress/pending-test.mdx`，不要直接写进正式功能说明；用户确认测试通过后再更新 `docs/content/docs/overview/features.mdx`。
- 每次任务完成前，都要根据实际变更检查并更新 `docs/content/docs/progress/todo.mdx` 和 `docs/content/docs/progress/pending-test.mdx`；如果功能或待办没有变化，也要确认无需修改。
- 文档不要写过期日期；除非用户明确要求记录具体时间。

## 发版本流程

- 未获得用户对当前待发布内容的明确确认前，不得提升版本号、提交发版、打 tag、推送或创建 GitHub Release；本地验收完成不等于获得发布授权。
- 软件内保留“测试版 / 稳定版”两个独立更新通道，分别接收 GitHub Pre-release 与正式 Release；不得擅自移除通道选择或改成由安装包身份强制锁定通道。
- 用户要求发版但未指定类型时，默认按测试版准备，但实际提升版本号、提交、打 tag、推送和创建 Pre-release 前仍须再次询问并获得确认；正式版必须获得用户对当次正式发布的明确确认。
- 发版本时，先把 `CHANGELOG.md` 的 `Unreleased` 变更整理成新的版本记录，并保留空的 `Unreleased` 标题。
- 按当前版本号提升一个版本，更新根目录 `VERSION`。
- 将当前未提交的代码全部提交到 Git。
- 提交完成后，给当前提交打最新版本号对应的 tag，例如 `v0.0.5`。
- 源码、桌面安装包、自动更新清单和 GitHub Release 统一维护于 `https://github.com/deepfry666/infinite-canvas-desktop-releases`；原私有源码库只保留历史备份，不再作为新开发入口。旧发行标签和安装包不可覆盖，历史源码基线见 `SOURCE_SNAPSHOT.json` 和 `OPEN_SOURCE.md`。
- 每次 GitHub Release 必须在 Release 正文写入本次用户可感知变更的更新日志，并同时上传安装包、更新清单和差分文件；用户确认安装前要有通知，升级后新版本首次健康启动要有完成通知。
- 每次发版都要在 GitHub Release 正文顶部提供简短中文更新说明，控制在 3–6 条、每条一句，优先描述用户可直接感知的变化，不照搬实现细节或完整 `CHANGELOG.md`。
- 发版本流程中不要执行编译、测试或构建，除非用户明确要求。

## 项目注意事项

- 当前公开源码按根目录 MIT 许可提供；第三方资源遵守 `THIRD_PARTY_NOTICES.md`。不得把私有开发历史、用户设置、无授权图纸或 MiSans 字体文件推入公开库。不得仅修改旧克隆的 remote 后推送整段私有历史；开发机迁移按 `OPEN_SOURCE.md` 重新克隆并审查必要改动。
- 正式产品名为「四季画布 FourJ Canvas」，桌面安装显示名 `productName`、窗口标题、托盘和系统通知均使用完整名称；`appId` 必须继续使用 `com.infinitecanvas.desktop`，打包应用的 `userData`/`sessionData` 必须固定到原 `appData/无限画布`，默认工作区必须继续使用「无限画布工作区」，避免升级后 API Key、偏好和本地内容不可见。canvas-agent 生态技术名（MCP `infinite-canvas`、npm `@basketikun/canvas-agent`、Codex 插件）保持 Infinite Canvas 原名。
- 调整项目、会话或资产保存层级时，必须同时识别并整理旧版本数据，保持工作区路径与记录引用稳定；迁移前创建恢复点，迁移后校验文件和引用，失败时保留原数据并继续从旧位置读取。禁止先切换到空的新目录、静默遗留旧资产，或让升级后的画布、图片、视频、生成记录和配置在界面中消失。
- 当前画布项目、“我的素材”和生成记录以本机桌面工作区为权威存储；可选 WebDAV 只用于跨设备同步，不要误写成云端账号存储或版本备份。
- 当前 AI API Key 存在桌面应用本地配置中，并由 Electron 渲染层直接请求 OpenAI 兼容接口；涉及安全说明时要写清楚。
- 四季画布是纯 Electron 桌面产品，不提供主应用网页端、Vercel、Render 或 Docker 发行方式；`web/` 只是桌面窗口的 React 渲染层。文档站是独立的资料站，不代表软件存在网页版本。
- Agent 对话消息必须同时按 `threadId`、`turnId` 和 `itemId` 归属；实时事件只用于补充未物化的 turn，历史快照成为权威后不得重复合并同一条消息。
- Agent 通信协议版本与消息存储版本必须独立管理；消息存储格式升级时必须先备份再迁移，遇到未知版本、损坏清单或冲突备份时拒绝覆盖原文件，不得按记录数量或文件大小静默裁剪历史元数据。
- 本地启动或浏览器验收时不要关闭用户已经打开的浏览器窗口或标签页；需要自动化验证时使用独立测试页面，避免打断用户当前页面和对话状态。
- 生图和视频工作台的实时结果、计时、轮询任务与当前查看状态必须按生成记录 ID 归属；查看历史记录不得覆盖活动任务，已完成记录必须显示冻结耗时，运行记录必须允许点回实时视图。
- 拖入参考图片、视频或音频时按内容复用已有工作区文件和旧路径，同内容重复拖入不得再次落盘或重复追加引用；不得为了去重搬迁、删除、覆盖旧资产或污染用户选择的源目录。
