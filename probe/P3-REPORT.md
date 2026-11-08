# P3 报告 · 事件时间线真机验证（2026-11-06 00:45）

> 验收口径（HANDOFF §3-1）：`POST /dsh-dual-screen/toggle` 开面板 → 截副屏图 → 「最近事件」里有投送记录。
> **结论：通过。** 但「通过」不是照原样点一下按钮就有的 —— 交接文档说的「代码就绪」其实是**没落地**，下面四条是这次挖出来的真因。

---

## 1. 先说坏了什么（三条，一条都不是「点一下就好」）

### 1.1 `panel-host.ps1` 根本没有 `-DataUrl`（交接文档写错了）

- `probe/patch-host-p3.mjs` 那个补丁脚本**从没生效**：它在 JS 里写
  `"  [string]$StageLog = 'E:\dsh\dual-screen\panel-host.log',"` ——
  `\d` `\p` 在 JS 字符串里不是转义序列，实际拼出来是 `E:dshdual-screenpanel-host.log`，
  匹配不到就**静默跳过**；只有后面那段 timeline 占位块（anchor 是纯 ASCII 注释）真插进去了。
- 后果：`lib/panel.js` 早在传 `-DataUrl:`，但 `param()` 里没这个形参，PowerShell 把它塞进 `$args` 就丢了，
  面板只渲染静态文案，**时间线永远是空的**，而且**不报错**。
- 修法：`.ps1` 补 `[string]$DataUrl = ''` + 2 秒 `DispatcherTimer` 轮询 + 行渲染。

### 1.2 旧补丁若生效会当场踩编码铁律

同一个补丁脚本要在 `.ps1` 里插 `"-> 副屏 "`、`"投送失败"` 这类**中文源码字面量**。
按 §14.2-1（PS 5.1 按 ANSI 读无 BOM 脚本），这会把后面那个 ASCII 字符吃掉。
→ 这次全部走 `panel/ui.json`（UTF-8 显式解码），`.ps1` 保持**纯 ASCII**（`grep -P "[^\x00-\x7F]"` 验证为空）。

### 1.3 面板 UI 是「绝对坐标堆出来的」

header / status / timeline 各自带死 Y 偏移（16 / 62 / 96 / 124），150% 下互相压。
→ 改成真 `Grid` 四行（header / status / body / bar），body 用 `ScrollViewer`。

---

## 2. 改了什么（代码）

| 文件 | 改动 |
|---|---|
| `bin/panel-host.ps1` | `-DataUrl` 形参；`Get-PanelData`（HttpWebRequest，Proxy=null，2s 超时）；`New-EventRow`（时间/圆点/动词/详情四列 Grid）；`Update-Timeline`；`Fit-Height` 自适应高度；Grid 四行布局；`-AvatarFile` + Q 版鲸鱼头像（`ImageBrush` 填 Ellipse = 天然圆形裁切，失败退回字符头像） |
| `panel/ui.json` | 新增 `avatarText` / `bridgeLabel` / `bridgeRunning/Stopped/Starting` / `movedLabel` / `portrait` / `statusRow` / `timeline{empty,moved,skip,failed,offline}`；文案改成「小肥鱼」人格（主人 2026-11-06 定名） |
| `panel/avatar.png` | 从 `dsh-whale-widget/assets/DSniang1.png` 复制（同一角色；挂件被卸也不影响面板） |
| `lib/panel.js` | 传 `-AvatarFile`；**修 `close()` 后状态显示 failed**（exit 回调尊重 `closing`） |
| `lib/index.js` | `/avatar.png` 优先用 `panel/avatar.png` |
| `probe/screengrab.ps1` | 新工具。**坑**：`Graphics.CopyFromScreen` 不缩放、按目标位图尺寸裁剪 → 先 1:1 抓再 `DrawImage` 缩放；另 `$Out`/`$out` 大小写不敏感撞车 |
| `probe/launch-console.ps1` | 新工具。**坑**：`start` 起的 conhost 父进程秒退，投送器回溯祖先链断裂 → 判 `no-rule` 不动；必须让中间进程活着（持有 `-HoldSec`） |

三处副本已同步，md5 一致（见 §4）。

---

## 3. 验证（可复现 + 真实输出）

```bash
# 1. 面板状态
curl -s http://127.0.0.1:8490/dsh-dual-screen/panel-window.json
# 2. 开/关（toggle）
curl -s -X POST -H "Content-Type: application/json" -d '{}' http://127.0.0.1:8490/dsh-dual-screen/toggle
# 3. 造一条真实投送（保持父进程存活，否则祖先链断裂判 no-rule）
powershell -NoProfile -ExecutionPolicy Bypass -File probe/launch-console.ps1 -Title ds-p3-final -HoldSec 35
# 4. 看事件
curl -s http://127.0.0.1:8490/dsh-dual-screen/panel.json
# 5. 截图（副屏 = 2560,-588 1600x2560；面板 = 3536,-564 600x1350 上限）
powershell -NoProfile -ExecutionPolicy Bypass -File probe/screengrab.ps1 -X:2560 -Y:-588 -W:1600 -H:2560 -Zoom:0.4 -Out:E:/dsh/dual-screen/shots/p3-secondary.png
```

真实输出（2026-11-06 00:42）：

```
# bridge.json
"moved": 2, "skipped": 2, "failed": 0, "lastEventAt": 1793896950441

# panel.json 事件（尾部）
{ "proc": "cmd.exe", "title": "ds-p3-final", "type": "moved", "reason": "moved", "ts": 1793896950439 }

# panel-host.log
00:40:14.266 [9452] avatar loaded: E:\...\dsh-dual-screen\panel\avatar.png
00:40:16.583 [9452] panel data: connected
00:41:52.457 [11288] fit-height need=480 content=140 max=1350 current=480
```

截图（证据文件）：

- `E:\dsh\dual-screen\shots\p3-panel.png` —— 面板特写：标题「小肥鱼」+ Q 版鲸鱼头像 +
  `投送 在线 · 已送 2` + 「刚才发生了什么」三行（`00:34 / 00:42 送到副屏啦 cmd.exe - ds-p3-*`）
- `E:\dsh\dual-screen\shots\p3-secondary.png` —— **整块副屏**：左上就是被投送过去的
  `ds-p3-final` 控制台窗，右上就是「小肥鱼」面板，任务栏在右下（确认是副屏本身）

---

## 4. 副本一致性

```
6498dc1364098aaec212faebbd5f0e60  bin/panel-host.ps1                        (源码)
6498dc1364098aaec212faebbd5f0e60  node_modules/dsh-dual-screen/bin/panel-host.ps1
4376e49866488c7186b92b712ee97a06  lib/panel.js / node_modules 副本（同值）
```
（`panel/ui.json`、`panel/avatar.png` 同样三处一致；每次改完都用 md5sum 对照，别信「应该同步了」。）

---

## 5. 无感投送（2026-11-06 01:00 追加，主人要求「主打无感」）

**问题**：旧实现只挂 `EVENT_OBJECT_SHOW` + 100ms 泵 → 窗口先在主屏**画出来**再被搬走，主人能看见闪一下。

**修法两层**：

1. **提前到 `EVENT_OBJECT_CREATE`**（0x8000）：窗口刚创建、**还没被绘制**，就 `SetWindowPos(... SWP_NOSIZE)` 把位置挪到副屏
   （只挪位置不改尺寸 —— 这时 conhost 还没排好版，改尺寸会和它打架）。
   控制台走 `ConsoleWindowClass`；浏览器走 `Chrome_WidgetWin_1` / `MozillaWindowClass`，且必须是 ego 起的
   （与 SHOW 判定同一套守卫：DSH 进程树 / ego 标记 / 只处理插件启动后新建的窗口）。
2. **泵从 100ms 降到 20ms**：原来每 100ms 才排空一次事件队列，那 100ms 就是「闪一下」的全部时长。

另外 `Get-Verdict` 的 `already-on-secondary` 守卫改成：**被我们 pre-move 过的窗口不算「本来就在副屏」**，
照旧跑完整 move+resize 并上报事件（事件里带 `"premoved": true`），这样时间线仍有记录。

**实测证据**（`probe/premove-check.ps1`：起 conhost，200 / 400 / 2200 ms 各拍一张主屏）：

```
{"target":12096,"t0":"00:48:37.066"}
f200/f400/f2200 -> E:\dsh\dual-screen\shots\premove-t{200,400,2200}.png
```
三张主屏截图里**都没有**新控制台窗口；同一时刻事件流是：

```
pre-move  cmd.exe  ds-premove3  ts=1793897318041     <- CREATE 阶段就挪走
moved     cmd.exe  ds-premove3  ts=1793897318484     <- 443ms 后补尺寸，premoved:true
```

副屏截图 `E:\dsh\dual-screen\shots\p3-final-secondary.png`：左边是被投送的 `ds-invisible` 控制台，
右边是置顶的「小肥鱼」面板（面板在 `p3-final-panel.png`，两行「送到副屏啦」）。

> 备选路线（主人也认）：先隐藏/最小化起在主屏，再搬到副屏。**没采用** —— 隐藏一个 conhost 窗口再显示，
> 会和 conhost 自己的 show 状态打架，而且会把工具链里本该**隐藏**的控制台误弹出来。CREATE 阶段挪位置已经够用。

---

## 6. 仍然没做的（下一步）

1. **P2b 侧栏按钮**：仍旧缺。client bundle 必须先在浏览器里跑通再进 profile（上次直接把 DSH 启动搞崩）。
2. **P4 问答镜像**：未开始。
3. **热重载根因**：`plugin_manager set_plugin` 仍 `next is not a function`；本轮改了 `lib/*.js`，
   只有**冷重启**才会生效（面板宿主 `.ps1` 是每次开窗新起进程，改完立即生效 —— 这点差别记住）。
4. 面板高度自适应目前是「装得下就缩」，拖高/记忆位置还没做（PLAN §7.7.3）。