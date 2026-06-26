# 项目改进进度追踪

## 已完成

### ✅ 1. TelemetryService 单元测试
- 新建 `src/app/telemetry.service.spec.ts`，共 15 个测试用例
- 覆盖：连接状态、序列号去重、事件环形缓冲区（上限 40 条）、自动重连计时器、Ping/Pong 延迟计算、容错（畸形 JSON）

### ✅ 2. WebSocket 延迟与抖动指标（Header）
- `telemetry.service.ts`：每秒发送 Ping，通过 RTT/2 计算单向延迟（完全规避服务端/客户端时钟偏差）
- `app.html`：新增 LATENCY 指标卡片，>150ms 变黄，>300ms 变红
- `models.ts`：新增 `ping`/`pong` 消息类型
- `server/server.ts`：新增 Pong 回应逻辑

### ✅ 3. 流程面板每步已用时间与进度条
- `models.ts`：每个 `PROCESS_STEPS` 条目新增 `durationMs` 字段
- `app.ts`：新增 `activeStepDurationMs` 和 `stepElapsedMs` computed signals
- `app.html`：当前激活步骤显示 `已用时间 / 预期时间` 和 CSS 进度条
- 修复 Bug：进度条填充元素从 `<i>` 改为 `<b>`，解决 CSS 选择器优先级冲突

---

## 待完成

### ✅ 4. Robot Data 标签页（机器人详细数据）
**预计工作量：** 3–4 小时

新增第二个 Tab，左右两栏分别展示 Arm A / Arm B 的详细硬件数据，无 3D 视图。

**实时数据（WebSocket 10 Hz）** — 随 `TelemetryFrame` 广播：
- 温度（°C）、电机电流（A）、母线电压（V）、液压油压力（bar）
- 每个指标含阈值进度条，>80% 变黄，>90% 变红

**维护数据（REST API 10 s 轮询）** — `GET /api/robots/:id/maintenance`：
- 剩余保养时间（hours）、润滑油量（%）
- 显示"Updated Xs ago"

**待做事项：**
- `server/server.ts`：新增 `GET /api/robots/:id/maintenance` 路由
- `server/simulation.ts`：`tick()` 中模拟硬件指标（温度/电流/电压/液压）
- `src/app/models.ts`：`RobotState` 新增 `hardware: { tempC, currentA, voltageV, pressureBar }`
- 新建 `src/app/robot-data/robot-data.ts`（standalone component）
- `src/app/app.ts`：新增 `activeTab = signal<'operator'|'robot-data'|'history'>('operator')`
- `src/app/app.html`：Header 下方添加 tab 导航栏，条件渲染三个视图

### ✅ 5. History 标签页（日志历史 + 过滤 + 分页）
**预计工作量：** 3–4 小时

新增第三个 Tab，展示历史日志，支持多维过滤和分页。

**过滤栏（单行紧凑，height:20px）：**
- 机器人下拉（All / Arm A / Arm B / Conveyor）
- 类型下拉（All / Info / Warning / Error）
- FROM / TO 时间文本输入
- CLEAR 按钮 + 右侧结果计数

**分页：每页 20 条，过滤后自动重置到第 1 页**
- 底部分页栏：`SHOWING X–Y OF Z EVENTS` | 页码按钮（超 5 页显示省略号+末页）| GO TO PAGE 跳转输入框

**待做事项：**
- `server/server.ts`：维护内存事件日志（上限 1000 条），新增 `GET /api/events` 路由支持 robot/type/from/to 查询参数
- 新建 `src/app/history/history.ts`（standalone component）
  - 过滤 signals + `filteredEvents = computed(...)` 前端四维过滤
  - 分页：`PAGE_SIZE = 20`，`currentPage = signal(1)`，`pagedEvents = computed(...)` 切片
  - 日志表格列：时间戳 | 机器人 | 类型徽章 | 代码 | 消息

### ⬜ 6. TCP 末端位置（正向运动学）
**预计工作量：** 3–4 小时
- `server/simulation.ts`：新增 `forwardKinematics()` 工具函数
- `src/app/models.ts`：`RobotState` 新增 `tcpPosition: [number, number, number]`
- `src/app/app.html`：在机械臂卡片显示 X / Y / Z（单位：米）
- `server/simulation.spec.ts`：新增 FK 确定性单元测试

### ⬜ 7. 周期节拍趋势图（纯 SVG，无第三方图表库）
**预计工作量：** 4–6 小时
- `telemetry.service.ts`：检测步骤切换，记录上限 60 条的环形缓冲区，暴露 `stepHistory` signal
- 新建 `src/app/cycle-history-chart.ts`：SVG 柱状图，按步骤着色，悬浮 tooltip
- `app.html`：流程面板下方新增可折叠图表区域

### ⬜ 8. OEE 综合指标面板（依赖第 7 项）
**预计工作量：** 6–8 小时
- 可用率（Availability）/ 性能率（Performance）/ 质量率（Quality）三分量计算
- 新建 `src/app/oee-panel.ts`：三格数字面板，带趋势箭头和公式 tooltip

---

## 推荐下一步

**Item 4（Robot Data 标签页）** — Tab 框架搭好后 Item 5（History）可连续完成，两项合计约 6–8 小时。
