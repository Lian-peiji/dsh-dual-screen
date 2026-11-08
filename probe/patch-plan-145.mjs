// 给 PLAN.md 追加 §14.5（2026-11-06 夜间第二轮施工记录）
import { readFileSync, writeFileSync } from 'node:fs'

const P = 'J:/大肥鱼游乐场/dsh-dual-screen/PLAN.md'
let s = readFileSync(P, 'utf8')
if (s.includes('### 14.5 2026-11-06 第二轮')) { console.log('already appended'); process.exit(0) }

const block = `
### 14.5 2026-11-06 第二轮（P3 落地 · 面板定名 · 无感投送 A+E · 侧栏开关）

#### 14.5.1 已完成

| 项 | 结果 | 证据 |
|---|---|---|
| **P3 时间线** | ✅ 真机通过 | \`-DataUrl\` + 2 秒轮询 + 双列事件行；面板「刚才发生了什么」出现 \`送到副屏啦 cmd.exe - ds-p3-final\`（\`probe/P3-REPORT.md\`） |
| **面板定名** | ✅ **小肥鱼**（包名/目录不变） | 主人 2026-11-06：「既然小窗是你的，你是大肥鱼，就叫它小肥鱼吧」 |
| **面板 UI** | ✅ 重做 | 真 Grid 四行（原来绝对坐标互压）、Q 版鲸鱼头像（\`panel/avatar.png\` = DSniang1）、高度自适应（\`Fit-Height\` 1350→480）、文案人格化 |
| **投送让出面板区** | ✅ | \`moveWindows.reserveRightPx\`（默认 624，物理 px）：控制台不再整块盖住面板 |
| **P2b 侧栏开关** | ✅ 真机可用 | \`lib/client.js\` → \`sidebar.footer.action\` id=\`dual-screen\` order 40；鲸鱼图标 + 状态点（绿=开/灰=关/暗=无副屏），点击 POST toggle，4 秒轮询；主人亲测「看到了，能用」 |
| **无感投送（A）** | ✅ | \`bin/run-on-secondary.ps1\`：CreateProcess + STARTUPINFO 直接**生在副屏**，默认 \`SW_SHOWMINNOACTIVE\`。实测：iconic=True、restore=2576,-572（副屏）、主屏零绘制 |
| **无感投送（E）** | ✅ | \`moveWindows.minimizeAfterMove\` 默认开：搬过去后 \`SW_MINIMIZE\`，不再盖面板/不再抢注意力；点任务栏恢复就落在副屏 |
| **无感投送（B 兜底）** | ✅ | CREATE 阶段 DWM cloak（\`DWMWA_CLOAK\`）+ \`WS_EX_NOACTIVATE\`，180ms 揭开、1.5s 恢复可激活；泵 100ms→20ms |

#### 14.5.2 架构修正：问答镜像不再走 BroadcastChannel

面板 v0.6 起是**原生 WPF**，不是网页 → §5.6 的 BroadcastChannel 方案作废。P4 改为**服务端中转**：

\`\`\`
页面 MutationObserver → POST /dsh-dual-screen/ask { callId, question, options }
   → 服务端 pendingAsks → 面板 panel.json 渲染待答区
   → 面板点击 POST /dsh-dual-screen/answer { callId, choice }
   → 页面轮询取答案 → 代点 DOM 按钮
   → DOM 契约不认识时：显示「去主屏处理」，绝不假装成功
\`\`\`

#### 14.5.3 新踩的坑（都写进代码注释了）

1. **PowerShell 大小写不敏感又咬人**：参数 \`$Show\`（switch）与局部 \`$show\` 撞车 → \`Cannot convert Int32 to SwitchParameter\`。改 \`$showMode\`。同 §14.2-3 的 \`$H/$h\`。
2. **\`CreateProcess\` 必须给可执行文件完整路径**：传裸 \`cmd.exe\` 直接 \`-2 FILE_NOT_FOUND\`；且必须带 \`CREATE_NEW_CONSOLE(0x10)\`，否则子进程挂到父控制台、根本不建窗口。
3. **\`.ps1\` 里加中文注释又会把 Add-Type 搞崩**（无 BOM 时 PS 5.1 按 ANSI 读）→ 本轮所有 \`.ps1\` 保持纯 ASCII，中文只在 \`.md/.json/.js\`。
4. **\`Graphics.CopyFromScreen\` 不缩放**：按目标位图尺寸 1:1 裁剪。截图工具必须先抓原尺寸再 \`DrawImage\` 缩。
5. **conhost 祖先链会断**：\`start\` 起的中间进程秒退 → 投送器回溯不到 DSH 进程树 → 判 \`no-rule\` 不动。测试台必须让中间进程存活。
6. **补丁脚本里的 JS 转义会静默失配**：\`"E:\\dsh\\..."\` 在 JS 里 \`\\d\` 变 \`d\`，anchor 匹配不到就悄悄跳过（上一轮 P3 补丁没落地就是这个）。

#### 14.5.4 决策表追加

| # | 问题 | 决定 | 状态 |
|---|---|---|---|
| 14 | 窗口怎么才算「无感」 | **A（自己起的窗口生在副屏）+ E（搬完最小化）+ B 兜底（cloak/NOACTIVATE）** | ✅ 主人 2026-11-06 拍板「要做，E 也要」 |
| 15 | 投送窗与面板重叠 | 投送宽度上限减去面板区（\`reserveRightPx\` 624） | ✅ 已实现 |
`

s = s.trimEnd() + '\n' + block
writeFileSync(P, s, 'utf8')
console.log('PLAN.md updated, lines now:', s.split('\n').length)