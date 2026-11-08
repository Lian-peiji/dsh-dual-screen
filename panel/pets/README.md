# 桌宠主题包规范（`panel/pets/`）

> 目标：**加一个新角色 = 丢一个文件夹进去**，不改一行代码。
> 主人 2026-11-06：「v2 的桌宠也要留口子，后续我会添加不同主题的 Q 版人物」。

## 1. 目录结构

```
panel/pets/
├── whale/                  ← 主题 id = 目录名
│   ├── theme.json          ← 必须有，没有这个文件的目录会被跳过（不报错）
│   ├── LICENSE.txt         ← 素材授权（别人的素材务必放）
│   ├── poster.png          ← 可选：没有 webm 时的静态兜底
│   └── webm/               ← 动画目录（默认名，可用 clipDir 改）
│       ├── 待机呼吸休闲.webm
│       └── ...
└── your-new-pet/
    ├── theme.json
    └── clips/              ← 也可以用别的目录名，theme.json 里写 "clipDir": "clips"
```

**发现机制**：插件启动时不扫描，每次请求 `/dsh-dual-screen/pets.json` 时现扫目录。
所以**加主题不用重启 DSH**，刷新面板/重开桌宠就能看到。

## 2. theme.json 字段

```jsonc
{
  "id": "whale",                  // 建议与目录名一致
  "name": "小肥鱼",                // 显示名（也当页面标题）
  "description": "一句话说明",
  "author": "画师 / 集成者",
  "version": "1.0.0",

  "clipDir": "webm",              // 可选，默认 webm

  "sprite": {                     // 可选，画面微调
    "anchor": "bottom",           // bottom（默认，脚底贴边）/ center
    "scale": 1.0,                 // 整体缩放
    "offsetX": 0,
    "offsetY": 0
  },

  "clips": {                      // ★ 核心：状态 → 动画池
    "idle":  ["待机呼吸休闲", "东张西望"],
    "sleep": ["睡觉-循环"],
    "think": ["工作状态-思考冒泡"],
    "work":  ["工作状态-忙碌点按", "写代码"],
    "wait":  ["工作状态-原地踱步张望"],
    "happy": ["工作状态-雀跃庆祝"],
    "sad":   ["工作状态-垂头叹气冒汗"],
    "drag":  ["被鼠标拖拽悬空反馈"],
    "click": ["点击回应-元气挥手"]
  },

  "random": ["原地专心玩魔方", "撸猫"],   // 空闲时的趣味动作池

  "timing": {
    "randomMinMs": 25000,         // 随机动作间隔
    "randomMaxMs": 60000,
    "fadeMs": 220,                // 状态切换的交叉淡入时长
    "bobPeriodMs": 4200           // 待机上下浮动周期
  }
}
```

**`clips` 里写的是文件名（不含 `.webm`）**，解析成 `<clipDir>/<名字>.webm`。

## 3. 状态词表（插件会传给桌宠的 mood）

| mood | 什么时候 | 说明 |
|---|---|---|
| `idle` | 默认 | 待机 |
| `sleep` | 15 分钟没动静 | 睡觉 |
| `work` | 有会话正在跑 | 跟着忙 |
| `wait` | 有待回答的问题（P4 卡片） | 等主人 |
| `think` | 预留 | 思考 |
| `happy` | 预留（任务成功） | 高兴 |
| `sad` | 最近出过错（20 秒内） | 沮丧 |
| `drag` | 正在被拖 | 悬空姿势 |
| `click` | 被点了一下 | 随机反应，一次性 |

级联规则：**请求的状态池 → `idle` 池 → `poster.png` → 一句提示**。
任何一环缺失都往下掉，**绝不出现空白窗口**。

## 4. 素材要求

| 项 | 要求 |
|---|---|
| 格式 | **VP9 编码的 WebM，带 alpha 通道**（`yuva420p`）。Chromium 原生支持，透明背景 |
| 推荐尺寸 | 480×480 左右，正方形；实际显示按窗口缩放 |
| 循环动画 | 首尾要接得上（待机/睡觉/工作这类会被 loop） |
| 一次性动画 | 点击回应/趣味动作这类不要循环，页播完自动回当前状态 |
| 体积 | 单个 ≤ 1 MB 为宜；太大启动会掉帧 |
| 授权 | **必须可再分发**（MIT / CC / 自绘）。别人的素材放 `LICENSE.txt` |

**转码参考**（本机 `E:\tools\ffmpeg`）：
```bash
# 从带 alpha 的 mov/png 序列转 VP9-alpha
ffmpeg -i in.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 32 out.webm
```

## 5. 加一个新主题：三步

1. **建目录**：`panel/pets/<新id>/`
2. **放素材**：动画丢进 `webm/`（或你指定的 `clipDir`），写 `theme.json`
3. **同步三份副本**（否则宿主读旧的）：
   ```bash
   for d in /e/dsh/profiles/desktop/local-plugins/dsh-dual-screen \
            /e/dsh/profiles/desktop/node_modules/dsh-dual-screen; do
     cp -r panel/pets/<新id> $d/panel/pets/
   done
   ```
4. **切过去**：`POST /dsh-dual-screen/config {"pet":{"theme":"<新id>"}}`，
   或者 `POST /dsh-dual-screen/pet {"action":"start","theme":"<新id>"}` 临时试。

**不用重启 DSH** —— 主题是数据，不是代码。

## 6. 已知主题

| id | 名字 | 素材来源 |
|---|---|---|
| `whale` | 小肥鱼 | dsh-pet v0.4.3（MIT，PC2005-cloud），36 个 VP9-alpha 动画 |
