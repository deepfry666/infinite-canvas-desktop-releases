# 四季画布 FourJ Canvas 版本说明

本文件记录当前公开更新通道。每个版本的完整变化、安装资产和发布时间以对应的 GitHub Release 为准。

## 稳定版

- 当前版本：[`v0.1.10`](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases/tag/v0.1.10)
- 安装包：`FourJCanvas-0.1.10-x64.exe`
- SHA-256：`a3816c1447b241a390f51cbf4a11049802d86ea052d30d19645c7c7ca36681fc`

本版本从已完成测试的候选版本重新构建，应用内版本、安装包文件名和自动更新清单均已统一为 `v0.1.10`。

## 测试版

- 当前通道版本：[`v0.1.11-beta.4`](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases/tag/v0.1.11-beta.4)
- 安装包：`FourJCanvas-0.1.11-beta.4-x64.exe`
- SHA-256：`1432a3719a7d9e9fe1389e0024b353dbc3147a15fac4b2a7efadabb44f3026a0`

该测试版修复 CPA 返回远程图片地址但桌面下载失败时被误报为生成失败的问题，并继续兼容图片 URL 数组、图片对象和 `image_url` / `imageUrl` 字段。

## 更多信息

- [软件功能、快速开始与数据说明](README.md)
- [全部版本与更新说明](https://github.com/deepfry666/infinite-canvas-desktop-releases/releases)
- [当前安装包校验清单](SHA256SUMS.txt)

当前公开安装包仅适用于 Windows x64，且尚未进行 Windows 代码签名。SHA-256 只能校验文件完整性，不能替代代码签名或证明发布者身份。
