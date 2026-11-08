# P0 探针报告 · dsh-dual-screen / 副屏管家

> 日期：2026-11-05 22:26 · 阶段：P0（探针 + 插件骨架）
> 结论：**屏幕枚举、窗口枚举、ego 窗口判定三项全部跑通，没有误判主人窗口。**
> 同时探出 4 条与 PLAN v0.5 假设冲突的事实（见 §4），需要主人点头后再改 P1 规则表。

---

## 1. 屏幕枚举 ✅

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File J:\大肥鱼游乐场\dsh-dual-screen\probe\screens.ps1
```

```
dpiBefore 0   dpiAfter 2   setDpiOk True   monitorCount 2
DISPLAY2 primary=True  x=0     y=0     w=2560 h=1440  work 2560x1392  dpi 96  scale 100%
DISPLAY1 primary=False x=2560  y=-588  w=1600 h=2560  work 1600x2488  dpi 144 scale 150%  portrait
virtualScreen {x=0, y=-588, w=4160, h=2560}
```

与 PLAN §13.1 完全一致。副屏可用区比整屏矮 **72px**（底部任务栏，48×1.5），
→ 摆窗必须用 `work*` 而不是整屏矩形，否则面板底部会被任务栏压住。

DPI 论证（`probe/dpi-proof.ps1`，实测）：

```
awareness before = 0    --->  [2560,-588] 1067x1707     ← 逻辑坐标，150% 被虚拟化
SetProcessDpiAwarenessContext(-4) = True
awareness after  = 2    --->  [2560,-588] 1600x2560     ← 真实物理坐标
```

## 2. 窗口枚举 ✅

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File J:\大肥鱼游乐场\dsh-dual-screen\probe\windows.ps1
# 机器可读全量：probe/out/windows.json
```

当前桌面 28 个可见顶层窗的判定分布：

| kind | 数量 | 说明 |
|---|---|---|
| ego-browser | 2 | 本鲸的 ego 浏览器（主窗 + 一个翻译气泡） |
| dsh-main | 1 | `DeepSeek Harness.exe` 主窗（**永不搬**） |
| owner-browser | 1 | 主人自己的 Edge（在托盘，parked 在 -32000） |
| other | 11 | 微信 / Nahimic / NVIDIA Overlay / Explorer / 设置 / 哔哩哔哩 等 |
| untitled | 13 | 无标题辅助窗（IME、隐形工具条） |

## 3. 「哪些是本鲸开的窗」判定 ✅（实测，非推测）

| 类别 | 判据（已验证有效） | 反例 / 陷阱 |
|---|---|---|
| ego 浏览器 | 进程名 `msedge.exe` **且** 命令行含 `--user-data-dir=…\ego-lite-linux\profile` 或 `--class=ego-lite-linux` | **父进程链不可用**：ego 进程的父进程已死（孤儿化），`inDshTree=False` |
| DSH 主窗 | 进程名 `DeepSeek Harness.exe` | 窗口类 `Chrome_WidgetWin_1` 跟 ego/主人的 WebView2 应用**同款**，按窗口类判必误伤 |
| 主人的浏览器 | 同名浏览器但命令行**没有** ego 标记 | 主人的「哔哩哔哩.exe」是 WebView2 应用，窗口类也是 `Chrome_WidgetWin_1` |

机读证据（`probe/out/windows.json` 摘录）：

```
ego-browser  msedge.exe#29580  [Example Domain - 个人 - Microsoft Edge]  10,10 1280x900  inDshTree=False
ego-browser  msedge.exe#29580  [翻译 俄语 页面?] 524,84 344x206                          inDshTree=False
dsh-main     DeepSeek Harness.exe#32316  1552x994  inDshTree=True
owner-browser msedge.exe#32856  [雨课堂…] -32000,-32000 160x28                            inDshTree=False
```

## 4. 与 PLAN 假设冲突的 4 条事实（需主人点头）

### F-A 终端归属：父进程链在 Win11 上不可用 ⚠️ 最要紧
PLAN §5.2 的 console 规则是「父进程链可达 DSH 进程树」。实测**不成立**：

```
实际可见窗：WindowsTerminal.exe#24960  title=WHALE-PROBE-CONSOLE
            父链 = WindowsTerminal.exe <- svchost.exe <- services.exe <- wininit.exe
我们的 cmd：cmd.exe#28016  父链 = cmd.exe <- powershell <- bash <- bash  ← 在 DSH 树里，但它没有窗口
```

Windows Terminal 是**单例**、被系统领养到 svchost，我们 spawn 的 cmd 被它托管成标签页。
后果：按父链判 → 我们的终端被判成「主人的」；按「终端宿主」判 → 主人的终端也是同一个进程。

**三个选项**（我推荐 A + C）：
- **A 保守**（推荐首版）：只在「能确认独占」的终端上投送（独立 conhost 窗，如 `conhost.exe cmd.exe`）；
  Windows Terminal 单例一律**不搬**，只在面板记一条「本鲸开了终端，但它在主人现有终端窗口里，未搬」。
- **B 激进**：时间窗归因（窗口新出现 + DSH 树 ±8 秒内有新控制台子进程）→ 能搬就搬。
  风险：可能把主人正开着的整个终端窗（含他自己的标签）搬到副屏。
- **C 改造**（推荐与 A 同时做）：插件带一个 `whale-console.cmd` 启动器，
  显式用独立 conhost 起控制台 → 归属从根上确定，也才有独立窗可投送。

### F-B 跨 DPI 移动必须两段式 ⚠️ 直接决定 P1 代码
单次 `SetWindowPos` 跨 100%→150% 边界时，**位置准确、尺寸被乘 1.5**（Chromium 响应 WM_DPICHANGED 自己重设）：

```
want                  2856,-564 1280x900
pass1 (250ms later)   2856,-564 1920x1350   ← 尺寸被 ×1.5
pass2 (settle)        2856,-564 1280x900    ← 补一次就准
pass3 (verify)        2856,-564 1280x900
```

→ P1 的 `move(hwnd)` 要按「设位 → 等 `dpiSettleMs`（默认 250）→ 再设一次」实现，
  已写进 `lib/config.js` 的 `moveWindows.dpiSettleMs`。量出来之前没人知道要补这一刀。

### F-C 必须过滤 parked / cloaked 窗口
Edge 会把托盘窗口留在 `-32000,-32000 160x28`，`IsWindowVisible=True`、`DwmGetWindowAttribute(CLOAKED)` 可能为 0。
→ 过滤器：`x <= -30000` 或「矩形与所有显示器无交集」或 cloaked≠0 → 一律不碰。
（已验证：主人的 Edge `雨课堂` 就是这种窗，按可见性判会把它搬出来。）

### F-D ego 浏览器窗口的来历
`browser.json` 显示 ego 用 `msedge.exe --no-startup-window --user-data-dir=…\profile --remote-debugging-port=0`，
窗口是随后通过 CDP `Target.createTarget` 建的。→ 启动参数里的 `--window-position` 对**这种 CDP 新窗**是否生效还没验证，
P1 里我会实测一次；不生效就纯靠投送器（和 PLAN §5.3 的“热开窗靠投送器”结论一致）。

## 5. 已经落地的骨架（源码就位，**尚未安装**）

```
J:\大肥鱼游乐场\dsh-dual-screen\
├─ package.json          name=dsh-dual-screen, dsh.bundle.patch, type=module
├─ cordis.patch.yml      insert 单行
├─ lib\config.js         config.json 读写（原子写）+ PLAN §6.1/§7.7 全部默认值
├─ lib\display.js        屏幕枚举（4s 缓存 + 单飞 + 失败回旧值）+ 面板/工具窗落点
├─ lib\index.js          cordis 入口：2s 轮询热插拔 + 4 条路由（health/displays/config/layout-preview）
├─ bin\display-info.ps1  Per-Monitor V2 屏幕探针（stdout 只吐 JSON）
└─ probe\               P0 探针脚本与证据（screens/windows/move-test/move-test2/dpi-proof）
```

验证（不是“能编译”，是真跑）：

```bash
node --check lib/index.js lib/config.js lib/display.js      # 三个全 OK
powershell -File bin/display-info.ps1 -OutFile E:\dsh\dual-screen\logs\displays-last.json
#   exit=0, stderr 空, stdout 1619 bytes 纯 JSON
node --input-type=module -e "import('./lib/display.js').then(async m=>{const d=await m.getDisplays(true);console.log(d.count, d.hasSecondary)})"
#   → 2 true
```

落点计算（`layout-preview` 将返回）：

```
面板   副屏右上角 margin=24  ->  x=3536 y=-564 w=600  h=1350   (400 DIP × 1.5)
工具窗 副屏左上剩余区        ->  x=2584 y=-564 w=1280 h=900
```

**安装没做**：按“攒着一次性重启”的规矩，等 P1 代码写完一起装 + 一次重启。

## 6. 顺手记下的坑（写进代码注释了）

- **PS 5.1 读无 BOM 的 .ps1 按 ANSI 解码**：中文注释会吃掉后一个 ASCII 字符，
  `param()` 直接解析失败。→ 本插件所有 `.ps1` 一律纯 ASCII（display-info.ps1 已改）。
- `Get-CimInstance`/`whoami` 在 workspace-write 文件沙箱下返回 Access denied，
  切到 full-access 才正常；插件跑在宿主进程里不受这层限制（但探针要在真环境下跑）。
- 排序/表格里 `[ordered]@{}` 不能当 PSCustomObject 用（列会全空），
  且 `ContainsKey([uint32])` 与 `[int]` 键不等价 → 会静默查不到进程，必须 `[int]` 归一。

## 7. 下一步（等主人确认）

1. 认可上面 4 条事实与 A+C 推荐 → 我按修订后的规则写 P1。
2. P1 交付后**一起装 + 一次重启**（装前备份 profile 的 package.json）。
3. P1 验收照 PLAN §9：我开 ego 浏览器 / 独立 conhost 终端 → 落副屏；主人自己的窗不动；焦点不变。