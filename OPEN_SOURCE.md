# 公开源码与开发机迁移

## 唯一维护入口

[infinite-canvas-desktop-releases](https://github.com/deepfry666/infinite-canvas-desktop-releases) 同时维护四季画布源码、安装包、更新清单与版本说明，保持原发行地址不变。

此次公开快照基于已发布测试版 `v0.1.11-beta.4` 对应的源码，而不是旧源码库的默认 `main`；完整提交标识见 `SOURCE_SNAPSHOT.json`。它不是新软件版本，没有提升版本号、打新标签或发布新安装包。

旧私有 Git 历史未导入。历史公开标签和安装包保持不变，因此旧标签不指向此次公开源码树，不能据此声称已经验证旧包的可复现构建。后续新版本应在本仓库源码提交上创建新标签，不覆盖历史标签或资产。

## 公开范围与许可

- 公开的自有与上游代码按根 MIT 许可提供，保留 `basketikun` 和 `deepfry666` 版权；第三方资源遵守 `THIRD_PARTY_NOTICES.md`。
- 不包含用户配置、API Key、WebDAV 凭据、工作区、生成内容或私有 Git 历史。
- 不包含开发期 `.agents/` 技能和可选外部 Codex 插件目录。该插件的元数据存在独立许可声明，不纳入本次 MIT 桌面源码分发；它不是普通用户的桌面运行依赖。
- 原转载的 Codex 协议长文改为自行撰写的官方文档索引，不将第三方全文纳入项目 MIT 授权。
- 不分发 MiSans 字体二进制。若系统已安装合法取得的 MiSans，仍优先使用该字体族；否则沿用原有 PingFang SC / Microsoft YaHei 等系统回退，不请求缺失字体文件。字体字形和换行可能因平台不同而变化。
- Noto Serif SC、PT Serif 保留原文件并附 SIL OFL 和版权说明。没有将任何第三方字体改为 MIT。

## 在另一台电脑继续开发

1. 先检查旧开发目录的 `git status`，单独备份尚未推送的改动；旧库未归档时可以同步，已归档时应另存本地补丁、文件或 Git bundle，不向只读旧库推送。GitHub 只能反映已上传内容，不能证明另一台机器没有新工作。
2. 在新目录克隆公开主库，不覆盖旧目录：

开发环境采用 Node.js 24 LTS，具体版本见 `.node-version`。支持 fnm 的环境可先运行 `fnm use --install-if-missing`；不要使用 Node 26 运行仍依赖 `--experimental-transform-types` 的既有测试。

```bash
git clone https://github.com/deepfry666/infinite-canvas-desktop-releases.git FourJ-Canvas
cd FourJ-Canvas
npm ci
npm --prefix web ci --legacy-peer-deps
npm run desktop:dev
```

3. 只迁移审查过的必要改动。不要导入旧 `.git`、用户配置、工作区或生成内容；不要仅修改旧克隆的 `origin` 后推送整段私有历史或旧标签。
4. 旧源码库的其他分支保留在原备份中，没有因本次整理被合并、删除或宣称全部完成。确认本机工作保留完整后，再停用旧开发目录。

## 应用身份与数据保持不变

- `appId` 继续为 `com.infinitecanvas.desktop`。
- `userData` / `sessionData` 继续使用原 `appData/无限画布`，默认工作区名称仍为 `无限画布工作区`。
- Electron Builder 仍向 `deepfry666/infinite-canvas-desktop-releases` 发行；稳定版/测试版通道和更新校验逻辑不变。
- 不在本次仓库整理中读写真实用户工作区、迁移数据或调用任何 AI 服务。

## 检查与后续发行

```bash
npm test
npm run web:typecheck
npm run web:build
```

这些是源码和渲染层检查，不等于已经运行 Windows 安装包。当前产品自动更新仅支持 Windows；安装、双更新通道、升级后配置/工作区保留及打包字体表现仍需在 Windows 上实机验收。没有真实模型抽样，不将离线测试描述为模型质量验证。

已有安装包仍包含当时的许可文件和资源。本次根 MIT 文件说明的是当前公开源码；没有覆盖历史包或把它们伪装成本次构建产物。后续发行须按 `AGENTS.md` 再次取得当次发版授权，并使用新的版本号。
