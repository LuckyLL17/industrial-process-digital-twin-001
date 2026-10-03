# 工业过程数字孪生与异常根因推理服务

纯后端 Node.js + TypeScript + Fastify 服务，默认无需 Docker、数据库或消息中间件即可运行。

## 启动

```bash
npm install
npm run dev
```

默认端口：`6301`。健康检查：`GET /health`。

## 业务闭环

- 领域状态模型与事件输入
- 可回放的时间序列/仿真流程
- 约束校验与风险门禁
- 方案版本、审计轨迹与异常处置
- 所有状态暂存于进程内，便于本机演示；可扩展为数据库、事件总线和实时流处理架构

## 增强业务闭环

- 配方版本、工艺窗口风险评估与审批
- What-if 工况推演，输出吞吐量、质量、能耗和风险
- 受控闭环控制命令，受操作窗口和高严重度异常门禁约束
- 维修窗口、备件准备、下游影响与 LOTO 锁定确认
- 综合过程健康评分

扩展接口：`/api/recipes`、`/api/control/commands`、`/api/maintenance/windows`、`/api/process/health-score`。
