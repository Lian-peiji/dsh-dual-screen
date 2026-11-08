// update-plan-153.mjs -- replace PLAN.md section 15.3 with the finished, verified
// version (the old text described a broken state that no longer exists).
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'J:/大肥鱼游乐场/dsh-dual-screen/PLAN.md'
let s = readFileSync(p, 'utf8')

const startMark = '### 15.3 鼠标改尺寸 · 规格与现状（2026-11-06 新增）'
const endMark = '### 15.4 未完成清单（按优先级）'
const i = s.indexOf(startMark)
const j = s.indexOf(endMark)
if (i < 0 || j < 0) throw new Error('section anchors missing')

const body = `### 15.3 鼠标改尺寸 · ✅ 已真机通过（2026-11-06 上午）

**做法（最终版）**：\`panel-host.ps1\` 里 \`ResizeMode = 'NoResize'\`，由我们自己的钩子全权接管手势：

| 消息 | 干什么 |
|---|---|
| \`WM_NCHITTEST\` | 光标落在边缘 7px 带内 → 答 \`HTLEFT(10)/HTRIGHT(11)/HTTOP(12)/HTBOTTOM(15)\`／四角 \`13,14,16,17\`，记下 \`dragEdge\` |
| \`WM_LBUTTONDOWN\` | 记住起始光标位置与窗口矩形，\`SetCapture\` 抓住鼠标 |
| \`WM_MOUSEMOVE\` | 按抓到的边算新矩形，\`SetWindowPos(SWP_NOZORDER|SWP_NOACTIVATE)\` 实时改大小 |
| \`WM_LBUTTONUP\` | \`ReleaseCapture\` → 落盘；纵向拖动把 \`resizedByUser\` 置真 |

**为什么不用系统自带的 resize 循环**（两个坑，都踩完了）：
- \`ResizeMode='CanResize'\` 时 **WPF 自己先认领 \`WM_NCHITTEST\`**，我们的 \`AddHook\` 拿不到，
  窗口能拖但**拖动状态永远是空**（日志：\`ENTER/EXIT axis=[]\`，NCHIT 分支是死代码）。
- \`ResizeMode='NoResize'\` 时钩子能收到消息了，但**系统不再跑模态 resize 循环**，
  窗口纹丝不动 → 只能自己算矩形、自己 \`SetWindowPos\`。

**坐标系**（第一版就栽在这）：\`WM_NCHITTEST\` 的 \`lParam\` 是**屏幕坐标**，进程是 PerMonitorV2，
不能直接和 \`GetWindowRect\` 的返回值比 —— 一律 \`ScreenToClient\` 转客户端再比 \`GetClientRect\`。

**保存规则**（免得自动缩放和主人抢方向盘）：

| 拖哪里 | 存什么 | 之后 Fit-Height |
|---|---|---|
| 左右边（10/11） | 只存 \`panel.width\` | 继续自动缩高度 |
| 上下边 / 四角 | 存 \`width+height+resizedByUser:true\` | 不再自动缩 |
| 复位 | \`POST /config {"panel":{"resizedByUser":false,"width":400,"height":900}}\` | 恢复自动缩 |

**真机验收记录（2026-11-06 08:59，\`probe/drag-test.ps1\`）**：

| 拖哪条边 | 窗口变化（物理） | config 落盘 |
|---|---|---|
| 右边 +90 | 600×480 → **627**×480 | \`w:418\`（只有宽） ✅ |
| 下边 +150 | 627×480 → 627×**630** | \`w:418 h:420 resizedByUser:true\` ✅ |
| 右边 +60 | 597×600 → **627**×600 | \`w:418\` ✅ |
| 下边 +120 | 627×480 → 627×**600** | \`w:418 h:400 frozen:true\` ✅ |
| 左边 +50 | → **597**×600 | \`w:398 h:400 frozen:true\` ✅ |
| 重开面板 | — | 尺寸被记住：ready 报 \`597×600\` ✅ |

**上边无变化是正确行为**：窗口已贴在副屏顶端（\`T=-564\`），再往上会越出可用区，钩子按最小高度兜住。

**验收工具**（都在 \`probe/\`，纯 ASCII）：
\`\`\`powershell
# 真实鼠标拖动某条边（DPI 感知 + 独占变量名，两个坑都在这里绕过）
powershell -File probe/drag-test.ps1 -Edge bottom -Delta 120

# 九点 hit-test（注意：SendMessage 走的是合成路径，真实拖动才代表最终结论）
powershell -File probe/hit-test.ps1
\`\`\`

`

s = s.slice(0, i) + body + s.slice(j)
writeFileSync(p, s, 'utf8')
console.log('PLAN 15.3 rewritten, lines', s.split('\n').length)