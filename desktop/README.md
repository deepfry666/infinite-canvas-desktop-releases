# Windows 桌面第一版（Electron）

桌面应用采用 Electron，界面由 `web/` 目录中的 React 渲染层提供；`web/` 是工程目录名，不代表另有网页端产品：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`

开发运行：

```bash
npm install
npm run setup
npm run desktop:dev
```

`setup` 会安装桌面渲染层依赖；由于上游 `@ant-design/pro-components` 与当前 antd 主版本存在 peer dependency 声明差异，安装时使用 `--legacy-peer-deps`。

构建 macOS Apple Silicon（arm64）目录包（后续平台）：

```bash
npm run desktop:pack:mac
```

输出目录：`release/macos/arm64/`。

构建 macOS Apple Silicon 安装包（`.dmg` + `.zip`）：

```bash
npm run desktop:dist:mac
```

输出目录：`release/macos/arm64/`。

构建 Intel Mac 安装包：

```bash
npm run desktop:dist:mac:x64
```

输出目录：`release/macos/x64/`。

构建同时支持 Apple Silicon 和 Intel 的 Universal 版本：

```bash
npm run desktop:dist:mac:universal
```

输出目录：`release/macos/universal/`。

保留 Windows 构建入口：

```bash
npm run desktop:dist:win
```

输出目录：`release/windows/`。根目录的 `desktop:pack` 和 `desktop:dist` 是 Windows 优先入口，分别等同于对应的 `:win` 命令。

当前 macOS 包未进行 Apple Developer ID 签名和公证。首次打开时，如果系统提示无法验证开发者，请在 Finder 中对应用右键选择「打开」，或在「系统设置 → 隐私与安全性」中选择「仍要打开」。正式公开分发前需要配置 Developer ID、签名和 notarization 环境变量。

当前 Windows 包也未配置代码签名证书。首次运行时如果 SmartScreen 拦截，请点击「更多信息 → 仍要运行」；正式分发前再接入 Windows 签名证书。

桌面应用使用固定 `app://local` origin，并把用户选择的普通文件夹作为独立工作区：画布与素材元数据写入 `projects/`，生成记录写入 `records/`，图片、视频和音频原文件按生成日期写入 `assets/images/YYYY-MM-DD/`、`assets/videos/YYYY-MM-DD/` 和 `assets/audio/YYYY-MM-DD/`。设置页还可分别为图片、视频、音频、项目数据和生成记录指定独立目录；更换总工作区时现有分类内容会迁移到新工作区各自区域，更换分类目录时会迁移到对应自定义目录，恢复默认时保留原自定义文件。应用不会移动 Chromium 的 Cookies、缓存或运行目录，因此 Windows 下不会再因 `Network\\Cookies` 被占用而迁移失败。浏览器预览仅供开发调试，并不是独立发行的网页端。

Windows 中点击窗口右上角关闭默认隐藏到系统托盘，不会中断生成任务；托盘菜单可重新打开或完全退出。也可在「设置 → 偏好设置」改为点击关闭时完全退出，有运行任务时仍会先提示中断与可能计费风险。

当前 API Key 仍按上游方式保存在本地浏览器存储中，配置导出默认不应分享给他人；macOS Keychain、Windows Credential Manager 和原生媒体目录会在后续版本接入。

桌面包只提供一个内置「对话」入口：它直接调用设置中选定的文字模型，不需要安装 Codex、Canvas Agent、MCP 或 Node 服务。对话支持新建、切换和删除本地会话，可以读取当前画布，并把创建、修改、删除、连线和触发生成整理成待确认的画布操作；确认后可撤销。旧版外部桥接能力仅保留在开发资料中，不属于当前用户流程。

## 中转站适配

渠道编辑中的「请求适配方式」有两种：

- 「协议预设」：继续使用 OpenAI、Gemini 或方舟的现有调用实现，也可以选择 APIMart GPT-Image-2 内置适配器。
- 「字段映射」：把画布稳定请求映射到中转站文档，不需要为每个模型重写脚本。支持 `$model`、`$prompt`、`$references`、`$referenceDataUrls`、`$options.size`、`$options.count`，响应可配置 `images` 或 `text` 路径，也可以配置异步任务的 `taskId`、轮询状态和结果路径。
- 渠道中的单个模型如果有不同文档，可以在该模型的「模型适配」中单独覆盖协议预设或字段映射；未覆盖的模型继续继承渠道设置。

最小图片接口示例：

```json
{
  "endpoints": {
    "image.generate": {
      "path": "/v1/images/generations",
      "body": {
        "model": "$model",
        "prompt": "$prompt",
        "n": "$options.count",
        "size": "$options.size"
      },
      "response": { "images": "$.data" }
    }
  }
}
```

APIMart GPT-Image-2 已内置“提交任务 + 轮询 + 结果归一化”流程；需要 multipart、特殊签名、SSE/WebSocket 或视频/音频专用字段时，仍可在模型的「旧版脚本」中暂时保留原调用。
