# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.2] - 2026-08-05

### 新增

- 编辑模式支持插入图片：编辑器里直接粘贴剪贴板图片，或点标题栏「插入图片」按钮多选本地文件；图片统一存到文档同目录的 `assets/` 文件夹（自动创建、重名自动递增），光标处插入相对路径 `![](assets/xxx.png)`，文档与图片同目录拷走即可分享

### 其他

- README 截图压缩约 73%，并改用 jsDelivr CDN 加速加载

## [0.5.1] - 2026-08-05

### 修复

- 修复右上角「外观」浮层被正文区完全遮挡、无法点选的问题：标题栏的 `backdrop-filter` 会让其成为新的层叠上下文，使浮层的 `z-index` 失效被正文盖住；该模糊效果在标题栏上本无视觉作用，已移除并改用纯色背景
- 外观浮层顶部对齐改为相对标题栏高度（`top: 100%`），不再因标题栏高度变化而错位

[0.5.2]: https://github.com/youhaqiu/su-md-viewer/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/youhaqiu/su-md-viewer/compare/v0.5.0...v0.5.1
