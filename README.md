# dsh-dual-screen · 小肥鱼

把 DeepSeek Harness 的工具输出"搬"到副屏的插件：**窗口投送**、**副屏常驻面板**、**透明桌宠**，外加一个能把进程直接生在副屏的 `run_on_secondary` 工具。

> 只用一台显示器也能装 —— 没有副屏时面板不启动、桌宠收起、手动 start 会被拒（`skipped=no-secondary`），不会挡主屏干活。

---

## 能做什么

| 能力 | 说明 |
|---|---|
| **窗口投送** | 本鲸调工具打开的浏览器 / 终端窗口，自动搬到副屏；`CreateProcess` + cloak 隐藏那一帧，搬完再显示，主屏不闪 |
| **副屏面板** | 副屏常驻一块面板（进程内 WPF），显示事件时间线、问答卡片、状态 chip；可拖边改尺寸。**收起态 = 桌宠**（2026-11-06 起不再有折叠圆气泡） |
| **副屏问答** | DSH 提问时主窗口照常弹 + 副屏镜像一份，**谁先答算谁**（`ask.mode='race'`），也可以配成只在副屏问 |
| **透明桌宠** | 副屏上一只透明、可点、可拖的鲸鱼娘（Electron 宿主，主题可插拔：`panel/pets/<id>/`） |
| **`run_on_secondary` 工具** | 让模型在副屏启动一个进程：窗口从第一帧就生在副屏，不闪主屏、不抢键盘焦点 |
| **设置页** | 设置 → 副屏管家：界面 / 窗口投送 / 桌宠 / 问答四组开关，改完点保存即写盘 |

---

## 环境要求

- **Windows 10/11**（依赖 WPF、`user32`/`kernel32` 的窗口 API，非 Windows 不可用）
- **DSH 桌面端**（插件需要 `webServer` 服务与本机窗口操作能力）
- Node ≥ 22（宿主自带）
- 桌宠需要 Electron（安装包自带一份 `E:\dsh\dual-screen\electron\`，首次使用会自行准备）
- 终端窗口走 Windows Terminal（`wt.exe`）；没有 `wt.exe` 时退回经典控制台（可能有一帧闪主屏）

---

## 安装

插件目录结构固定为 `lib/` + `bin/` + `panel/` + `client/` + `pet-electron/`，宿主加载入口是 `lib/index.js`。

本地开发可以直接拷进 profile（三处必须一致，否则宿主跑旧代码）：

```bash
# 源码 → local-plugins → node_modules
for d in "E:/dsh/profiles/desktop/local-plugins/dsh-dual-screen" \
         "E:/dsh/profiles/desktop/node_modules/dsh-dual-screen"; do
  cp -r lib bin panel client pet-electron cordis.patch.yml package.json "$d/"
done
```

改完热重载即可（不用重启 DSH）：

```
plugin_manager set_plugin include:dsh-dual-screen enabled=false
plugin_manager set_plugin include:dsh-dual-screen enabled=true
```

---

## 配置

配置文件：`E:\dsh\dual-screen\config.json`（写入是原子替换；读坏了会回落默认值，不会把插件拖死）。
日常改配置**请用设置页**，手改也只是合并到默认值上。

| 键 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `panel.autoOpen` | `false` | 随 DSH 启动打开面板（手动关掉的不会被弹回来） |
| `panel.topmost` | `true` | 置顶但不抢焦点 |
| `panel.width` / `height` | `400` / `900` | 展开尺寸（DIP），拖边改尺寸会自动记住 |
| `panel.collapsedSize` | `56` | 历史字段（折叠圆气泡已砍，收起态改由桌宠承担） |
| `moveWindows.enabled` | `true` | 窗口投送总开关 |
| `moveWindows.onlyAfterStart` | `true` | 只搬本机启动之后新建的窗口 |
| `moveWindows.respectManualDrag` | `true` | 手动拖回主屏后不再拉回 |
| `pet.enabled` / `pet.autoStart` | `true` / `false` | 桌宠开关 / 随 DSH 启动 |
| `pet.onlyOnSecondary` | `true` | 没有副屏就收起（桌宠是副屏的陪伴物） |
| `pet.theme` | `whale` | 主题 id，见 `panel/pets/<id>/theme.json` |
| `ask.enabled` / `ask.mode` | `true` / `race` | 问答镜像开关 / `race` 或 `panel-only` |
| `ui.sidebarButton` | `true` | 左侧菜单栏底部的小肥鱼开关按钮 |

数据目录 `E:\dsh\dual-screen\`：`config.json`、`logs\`、`shots\`、`edge-profile\`、`electron\`。

---

## 工具 `run_on_secondary`

让模型在**副屏**起一个进程：

```
run_on_secondary(command="cmd.exe", args="/k npm run dev", mode="show")
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `command` | — | 可执行文件或命令名（`cmd.exe` / `powershell.exe` / `npm.cmd` / `node` …） |
| `args` | — | 原样拼在命令后面；不能带换行 |
| `mode` | `minimized` | `minimized` 最小化出现在副屏 / `show` 可见但不抢焦点 / `hidden` 完全隐藏（后台任务） |
| `timeout_ms` | `20000` | 启动器等多久（5–60 秒） |

返回 `{ ok, pid, screen, rect, show, mode, message }`。单屏时回落到主屏，`screen` 字段会说真话。

> 这个工具是**可选件**：拿不到 `@deepseek-ai/dsh-tools` 时插件用自带的等价 `defineTool` 顶上；
> 连启动器都起不来时只在 `health.json` 的 `tool` 字段里报错，**绝不影响宿主启动**。

---

## 排障

| 现象 | 检查 |
|---|---|
| 面板不出现 | `curl http://127.0.0.1:<端口>/dsh-dual-screen/health.json` 看 `active` / `hasSecondary`；单屏时 `active=false` 是正常的 |
| 窗口没被搬 | `health.json` 的 `monitors` 是否 2；`moveWindows.enabled`；窗口是不是手动拖回主屏过（`respectManualDrag`） |
| 工具没出现 | `health.json` → `tool.registered` / `tool.error` |
| 桌宠不动 | 跑 `probe/pet-motion-check.ps1`（两帧像素比对，截图好看不代表在播） |
| 改完没生效 | 三处目录是不是同步了；热重载开关是否真的切过（`enabled=false` 再 `true`） |

日志：`E:\dsh\dual-screen\logs\`、`panel-host.log`、`pet-host.log`。

---

## 开发

```bash
node probe/p1-plugin-load.mjs    # 离线加载插件（mock ctx）：apply 抛错会在这一步被抓到
node probe/test-p3-events.mjs    # 事件流
node probe/test-p3-mood.mjs      # 状态映射
node probe/test-p4-race.mjs      # 问答竞速
powershell -File probe/check-ps1.ps1 -Path bin/run-on-secondary.ps1   # .ps1 必须纯 ASCII
```

三条硬规矩：

1. **改 `lib/*.js` 后必跑 `probe/p1-plugin-load.mjs`** —— 上次 `apply()` 里抛异常把宿主搞挂过。
2. **`.ps1` 只写 ASCII** —— PowerShell 5.1 按 ANSI 读无 BOM 脚本，中文会乱码成语法错误。
3. **可选功能失败必须降级** —— 任何"锦上添花"的东西挂了都不许拖累宿主启动。

### 目录

```
lib/index.js        服务端主体：路由、投送器、面板/问答/桌宠编排、run_on_secondary
lib/hostdeps.mjs     宿主 @deepseek-ai/* 依赖解析 + defineTool 本地等价实现
lib/config.js        配置读写（原子写、读坏回落默认）
lib/display.js       显示器枚举与几何
lib/windows.js       窗口查找/投送（CREATE_PROCESS + cloak）
lib/panel.js         面板宿主进程编排
lib/pet.js           桌宠（Electron）编排
lib/client.js        客户端半边：侧栏开关 + 设置页
bin/*.ps1            PowerShell 执行体（面板宿主、桌宠、投送、启动器）
panel/               面板 UI 与桌宠主题（pets/<id>/theme.json）
pet-electron/        桌宠 Electron 宿主
probe/               离线测试与真机探针
```

## 许可

MIT
