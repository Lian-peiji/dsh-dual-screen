import { readFileSync, writeFileSync } from 'node:fs'
const p = 'J:/大肥鱼游乐场/dsh-dual-screen/PLAN.md'
let s = readFileSync(p, 'utf8')
const start = s.indexOf('### 14.3 重启口径')
const end = s.indexOf('### 14.4 验收口径')
if (start < 0 || end < 0) { console.log('MISS 14.3'); process.exit(1) }
const block = [
  '### 14.3 重启口径（主人 2026-11-05 三次修正后的定稿）',
  '',
  '> 主人原话（第三次，定稿）：「我的逻辑是对话输出结束，需要重启，判定没有别的对话活着，延迟 20s 看用户是否有新的输入，',
  '> 即将执行时看看用户有无发送新消息启动对话，有就延迟重启，没有就执行。最多留个 20 多秒给用户判断一下就行。」',
  '',
  '**四步时序（缺一不可）**：',
  '',
  '1. **输出结束** —— 回复先发完，再排重启（延迟 20 秒起，覆盖渲染）',
  '2. **查有无别的对话活着** —— 扫 `E:\dsh\sessions` 全部会话的 `session.v4.jsonl.zstd` 文件级 mtime；',
  '   有冲突 → **排队**（runner 等它安静），**不问主人**；无冲突 → 直接排',
  '3. **等 20 秒** —— 留给主人的判断窗口',
  '4. **即将执行时再确认** —— 执行器自查「21 秒内有没有人动过任何会话」，有就继续等，没有就执行；最多等 3 分钟',
  '',
  '| 参数 | 值 | 说明 |',
  '|---|---|---|',
  '| `delaySec` | **20** | 排重启的延迟（秒） |',
  '| `quietMin` | **0.35**（21 秒） | 活跃判定窗口；`runner.ps1` 已改 `[double]`，`restart-lib.ps1` 的 `BusyMin` 同步改 `[double]` |',
  '| `maxWaitMin` | **3** | 主人持续输入就放弃，不硬来 |',
  "| `excludeSession` | **''** | 不排除自己 |",
  '| `policy` | safe | 到点后由 runner 再确认；`continue` 仅作「现在就重启」的逃生口 |',
  '',
  '**铁律不变**：绝不只杀不拉、绝不打断别的对话（排队而非强推）、攒着一次性重启、结果先返回、重启后让主人刷新页面。',
  '',
  '**不要再问「要不要重启」** —— 已授权的动作只做「自查 → 执行 → 告知」。',
  '',
].join('\n')
s = s.slice(0, start) + block + s.slice(end)
writeFileSync(p, s, 'utf8')
console.log('PLAN 14.3 rewritten: 20s window, queue on conflict, never ask')
