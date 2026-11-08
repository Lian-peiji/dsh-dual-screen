# P1 投送器报告 · dsh-dual-screen

> 日期：2026-11-05 22:35 · 阶段：P1（WinEventHook + 规则表 + 坐标 + 排除表 + 热插拔 + 上报）
> 结论：**验收 9/9 全绿**，已按官方命令装进 profile（应用 1 次重启验证真实加载）。

## 1. 交付了什么

| 文件 | 作用 |
|---|---|
| `bin/window-bridge.ps1` | 投送器本体：`SetWinEventHook(EVENT_OBJECT_SHOW)` + 规则引擎 + 两段式移动；stdout 一行一个 JSON |
| `lib/windows.js` | 进程管理：拉起/解析/计数/异常重启一次（绝不进程风暴）/收尸 |
| `lib/display.js` | `panelRect` 改成 DIP→物理像素换算（400 DIP = 600 物理 @150%） |
| `lib/index.js` | 双屏且开启才拉起投送器；屏数变 1 或关功能立即收尸；新增 `/bridge.json`、`/bridge/restart` |
| `bin/whale-console.cmd` | 选项 C：用 `conhost.exe` 起独立控制台，归属可判定 |

## 2. 规则表（P0 实测后经主人批准的版本）

| 规则 | 判据 | 为什么 |
|---|---|---|
| ego 浏览器 | `msedge/chrome/...` 且命令行含 `--user-data-dir=…ego-lite-linux` 或 `--class=ego-lite-linux` | ego 进程父链已死（孤儿），只能靠命令行；`Chrome_WidgetWin_1` 与主人 WebView2 应用同款，不能按类判 |
| console | 窗口类 `ConsoleWindowClass` **且** 窗口进程在 DSH 进程树 **且** 启动时间 ≥ 投送器启动 | 窗口进程就是 cmd.exe 本身 → 可归因 |
| 不搬（只记日志） | 窗口类 `CASCADIA_HOSTING_WINDOW_CLASS` | Windows Terminal 单例被 svchost 领养，搬它会连带主人的标签页 |
| 排除 | DSH 主窗、cloaked≠0、`-32000` parked、与所有屏无交集、<300×180、浏览器辅助气泡 <600×400、已在副屏、搬过一次的 | 每一条都有实测反例（见 P0-REPORT §4 F-C） |

## 3. 验收（命令 + 原样输出）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File J:\大肥鱼游乐场\dsh-dual-screen\probe\p1-acceptance.ps1
```

```
PASS  bridge starts and emits hello   hookOk seen: True
PASS  browser with ego marker gets moved   {"type":"moved","kind":"ego-browser","proc":"msedge.exe","from":[48,48,1200,841],"want":[2584,-564,1200,841],"got":[2584,-564,1200,841]}
PASS  browser window really on secondary   rect=2584,-564 1200x841
PASS  console in DSH tree gets moved   {"type":"moved","kind":"console","proc":"cmd.exe","class":"ConsoleWindowClass","from":[312,312,993,519],"got":[2584,-564,993,519]}
PASS  console window really on secondary   rect=2584,-564 993x519
PASS  Windows Terminal window is skipped, not moved   {"type":"skip","reason":"windows-terminal-singleton","proc":"WindowsTerminal.exe"}
PASS  Windows Terminal window still on primary   rect=330,338 1129x635 cls=CASCADIA_HOSTING_WINDOW_CLASS
PASS  no pre-existing window was moved   0 unexpected changes of 29 baseline windows
PASS  mover never steals focus   2 moves checked; focus unchanged around every SetWindowPos
RESULT: pass=9 fail=0
```

插件加载/集成（不用重启先验掉，跑法 `node probe/p1-plugin-load.mjs`）：

```
[PASS] module exports name/inject/apply  name=dual-screen inject=["webServer"]
[PASS] 6 条路由全部注册
[PASS] health sees two monitors  monitors=2
[PASS] health dpi-aware per-monitor  dpiAwareAfter=2
[PASS] bridge controller started by plugin  status=running
[PASS] bridge hook installed
[PASS] panel lands on secondary right  {"x":3536,"y":-564,"w":600,"h":1350}   ← 400x900 DIP @150%
[PASS] tool window lands on secondary left  {"x":2584,"y":-564,"w":1280,"h":900}
[PASS] dispose stops the bridge process  pid=4804
RESULT: all checks passed
```

## 4. 安装记录

- 备份：`E:\dsh\profiles\desktop\package.json.bak-dual-screen-20261105-223322`
- 只走官方命令：`plugin_manager action=install_bundle target=file:./local-plugins/dsh-dual-screen`
  → pnpm `+1 -32`（-32 是 pnpm 重链本地 file: 包，事后核对 `dsh-ops`/`dsh-ego-browser`/`dsh-whale-widget`/`sage-mem` 全在，158 个模块）
  → `application: failed / next is not a function`：**新 bundle 无法热应用，需一次重启**（不是插件代码错误，`p1-plugin-load.mjs` 已把加载路径单独验过）
- 三处副本 md5 一致：`lib/*.js`、`bin/*.ps1` （src = local-plugins = node_modules）
- 重启：走 `dsh-restart-guard`（计划任务 `DSH-Restart-Guard`，延时 90s，policy=continue）
  —— 重启前查过会话 mtime：只有本会话 0 分钟，其余 ≥17 分钟，按《重启授权》没人用则直接重启。

## 5. 诚实说明的边界

1. **console 覆盖率**：只有走 `conhost.exe` 起的控制台会被搬。工具链里直接 `cmd /k` 出来的窗会进 Windows Terminal 单例，
   按 A 案不搬（只记 `windows-terminal-singleton` 日志）。要它被搬，就用 `bin\whale-console.cmd`。
2. **ego 冷启参数**（PLAN §5.3 `chromeArgs` 加 `--window-position`）**还没验**：窗口是 CDP 事后建的，启动参数对它大概率无效。排到 P2 一起测。
3. 投送器崩溃只重启 1 次，再崩就停在 `failed` 并留日志 —— 宁可少投送，也不做进程风暴。

## 6. 下一步

P2：面板 HTML 骨架 + `msedge --app` 拉起 + 定位（用 `layout-preview` 的 600×1350@3536,-564）+ 侧栏按钮三态 + 开关闭环。