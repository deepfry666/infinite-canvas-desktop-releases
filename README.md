<p align="center"><img src="web/public/logo.svg" width="96" alt="四季画布 FourJ Canvas 标志"></p>

# 四季画布 FourJ Canvas

本地优先的 AI 视觉创作桌面应用，将无限画布、图片与视频生成、素材管理、提示词、创作记录和内置对话集中在一个工作区中。

**本仓库现在同时管理公开源码、安装包、版本记录和自动更新。** 基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 独立维护，代码采用 [MIT](LICENSE)；第三方资源分别遵守 [相关声明](THIRD_PARTY_NOTICES.md)，不代表上游官方版本。

## 下载与使用

- [稳定版 v0.1.10](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases/tag/v0.1.10)
- [测试版 v0.1.11-beta.4](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases/tag/v0.1.11-beta.4)
- [全部版本与校验文件](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases)

当前公开安装包面向 Windows x64，尚未进行 Windows 代码签名。请确认来源并核对校验值；模型由使用者自行配置，调用费用由对应服务商收取。

安装后在设置中配置 AI 服务、默认模型和本地工作区，即可从画布、生图或视频工作台开始创作。API Key、WebDAV 凭据和用户内容不应上传到仓库；导出的设置可能包含这些凭据。

## 本地开发

使用 Node.js 24 LTS（验证版本见 `.node-version`）；原有测试使用 Node 24 的 TypeScript 转换能力，不支持移除了该实验参数的 Node 26。若使用 fnm，可在进入项目后运行 `fnm use --install-if-missing`。

```bash
git clone https://github.com/deepfry666/infinite-canvas-desktop-releases.git FourJ-Canvas
cd FourJ-Canvas
npm ci
npm --prefix web ci --legacy-peer-deps
npm run desktop:dev
```

常用检查：`npm test`、`npm run web:typecheck`、`npm run web:build`。Windows 打包与平台边界见 [桌面开发说明](desktop/README.md)。

本次公开源码基于 `v0.1.11-beta.4`，没有提升软件版本或重新发布安装包。MiSans 字体文件未分发；系统装有该字体时继续使用，否则采用原有系统字体回退。Noto Serif SC 和 PT Serif 附带 SIL OFL 许可。

## 文档

- [公开范围、历史标签与另一台电脑迁移](OPEN_SOURCE.md)
- [源码基线](SOURCE_SNAPSHOT.json) · [版本记录](CHANGELOG.md)
- [功能文档索引](docs/index.md)
- [待实机验证事项](docs/content/docs/progress/pending-test.zh-CN.mdx)
- [上游来源](NOTICE.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

画布、素材及生成记录以本机工作区为权威存储；可选 WebDAV 是同步方式，不能替代独立备份。仓库整理不改变应用身份、数据路径或现有双更新通道。
