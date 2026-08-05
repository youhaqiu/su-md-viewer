# Changelog

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.1] - 2026-08-05

### 修复

- 修复右上角「外观」浮层被正文区完全遮挡、无法点选的问题：标题栏的 `backdrop-filter` 会让其成为新的层叠上下文，使浮层的 `z-index` 失效被正文盖住；该模糊效果在标题栏上本无视觉作用，已移除并改用纯色背景
- 外观浮层顶部对齐改为相对标题栏高度（`top: 100%`），不再因标题栏高度变化而错位

[0.5.1]: https://github.com/youhaqiu/su-md-viewer/compare/v0.5.0...v0.5.1
