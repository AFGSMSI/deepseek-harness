# Agent Note：桌面会话级深链

Status: implemented

[English](2026-11-24-desktop-session-deep-link.md) | 中文

## 问题

Agent HUD 等外部生产者希望复制一个 `dsh://open/?session=<id>` 链接，从浏览器、笔记或其他应用打开同一个会话。在此之前，桌面入口虽然注册了 `dsh:` 协议，但 `dsh://open` 只会聚焦窗口；携带会话目标的链接被忽略。完全退出后的 macOS 冷启动和已在运行的实例都需要能跳到另一工作区的会话，而无效或不可访问的目标必须保持当前会话并给出明确反馈，不能导航到空处。

## 决策

本次只交付会话层级。消息与回合定位（`seq`）推迟到后续层级。

### 主进程解析

[`deep-link.ts`](../../../../apps/desktop/src/deep-link.ts) 严格解析单个目标：

- 协议 `dsh:`、主机 `open`、路径为空或 `/`、单个 `session` 参数（重复参数保留第一个值）。
- 白名单 id：`session-` 加 36 字符虚线 UUID 或 32 位紧凑小写十六进制；`orchestrator-` 加 8–64 位小写十六进制。
- 其余形式一律解析为 null。裸 `dsh://open` 保留原先只聚焦窗口的行为。

### 入口

- 冷启动：Windows 重启进程时链接在 `process.argv` 中，在 `main()` 启动时扫描；macOS 通过 `open-url` 交付链接。
- 运行中实例：Windows 通过 `second-instance` 启动参数传递链接；macOS 通过 `open-url` 交付。
- 模块级待处理目标保留到工作区渲染层取走。若已有活动窗口，目标立即经 `deepLinkChanged` 推送；否则等待工作区启动。

### 预加载桥接

应用预加载暴露 `dshDesktop.deepLink`：`take()` 取走并清空冷启动待处理目标；`subscribe(listener)` 返回退订函数。IPC 通道为 `deep-link-take`（invoke）与 `deep-link-changed`（事件）。take 处理器保留既有的产品发送方校验。

### 渲染层导航

[`deep-link.ts`](../../../../packages/client/ui-workspace/src/client/deep-link.ts) 挂在工作区插件生命周期上，没有桥接时为空操作。它取走冷启动目标并订阅后续链接，等待会话与工作区两份快照都进入 `ready` 后：

- 已列出且未归档的会话调用 `openSession`；
- 已归档会话弹出既有的 `archivedNotOpenable` 提示；
- 未知或不可访问会话弹出新的 `deepLinkUnknown` 警告，当前选中保持不变。

后入队的目标取代更早的目标。销毁时退订两份列表来源与桥接。

## 已考虑的替代方案

**在渲染层解析。** 主进程只转发原始 argv 或 URL 字符串，由渲染层重新实现协议、主机和 id 规则，可能在快照就绪前就因畸形链接发生导航。主进程拥有协议注册与发送方信任，因此校验留在主进程。

**链接中传递完整 SessionTarget。** 子智能体地址是复合对象，不是单个 id 字符串；本层级只解析普通会话 id。

**不等快照就绪，在 second-instance 时直接打开。** 工作区列表可能仍在 pending，过早保留引用或导航会与启动对账竞争。两份基线就绪后再取走目标，与既有启动导航一致。

**把归档会话按未知处理。** 既有归档提示已经告知用户取消归档；复用它保留同一条恢复路径，避免再写一份提示文案。

## 后果

- 合法会话链接在工作区启动后跨工作区到达目标会话；冷退出与运行中两条路径都覆盖。
- 畸形、未知或不可访问的目标都不会改变当前选中；归档会话走归档提示。
- 桥接是可选的：Web 构建与旧版桌面预加载不安装任何内容。
- 消息与回合定位仍不在范围内；后续层级可以一起扩展解析器与渲染层。

## 测试

- [`deep-link.spec.ts`](../../../../apps/desktop/tests/deep-link.spec.ts) 覆盖虚线与紧凑会话 id、orchestrator id，被拒绝的主机/路径/参数/形态/大写/非 URL 形式，以及 argv 扫描与空参数回退。
- [`single-instance.spec.ts`](../../../../apps/desktop/tests/single-instance.spec.ts) 把 second-instance 的 argv 转发给归属进程，并保留空 argv 回退。
- [`deep-link.client.spec.ts`](../../../../packages/client/ui-workspace/tests/deep-link.client.spec.ts) 覆盖无桥接空操作、冷启动已知/未知/归档目标、等待两份启动基线、运行中实例订阅，以及后入队目标取代先前目标。
- 既有 main-startup 与 welcome-startup 套件覆盖 second-instance 与 open-url 接线。
