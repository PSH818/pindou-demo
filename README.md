# 拼豆图纸设计工具 · Demo

[![Check & Deploy](https://github.com/PSH818/pindou-demo/actions/workflows/deploy.yml/badge.svg)](https://github.com/PSH818/pindou-demo/actions/workflows/deploy.yml)

上传一张图片，在浏览器本地把它转换成可编辑、可导出的拼豆图纸。图片计算和图纸存储全部在用户设备上完成，无需登录，也没有服务端。

**在线体验：<https://psh818.github.io/pindou-demo/>**（建议使用桌面版 Chrome / Edge，手机也可用）

## 30 秒体验路径

1. 首页点 **「用示例图试试」**，或上传自己的图片（也支持 Ctrl+V 粘贴）。
2. 预处理：可裁剪、镜像、一键去除纯色背景，点「下一步」。
3. 转换设置：选择珠子品牌、横向格数和颜色精简程度，点「开始转换」；也可以点「对比两种算法」同屏比较。
4. 编辑：画笔 / 橡皮 / 填充 / 取色（快捷键 B / E / F / I），Ctrl+Z 撤销，色板可高亮同色珠子。桌面端用滚轮缩放，按住空格或右键拖动画布，右上角可一键「适合屏幕」。
5. 导出 PNG / PDF / 用料清单；或进入「制作」视图，按颜色逐个打勾，并按珠板尺寸分块打印。

另外两个入口：**空白画板**（自由手绘）和 **分析图纸**（上传别人的数字图纸，识别网格、反推色号和用量）。

## 设备支持

| 环境 | 说明 |
|---|---|
| 桌面 Chrome / Edge / Safari | 完整支持；滚轮缩放，空格或右键拖动画布 |
| iOS Safari 15+、安卓 Chrome | 双指缩放平移；导出时弹出保存面板，iOS 可通过分享面板「存储图像」存进相册 |
| 微信 / QQ 内置浏览器 | 图片导出改为长按保存；PDF 需点右上角「在浏览器打开」后再导出 |

手机照片会先等比缩小到最长边 2048 像素再处理，避开 iOS Safari 的画布尺寸上限，转换结果不受影响。图纸只保存在当前浏览器里；iOS Safari 可能清理长时间未访问网站的本地数据。

## 技术亮点

| 方向 | 做法 |
|---|---|
| 计算不卡界面 | 图片缩放、取样、颜色量化、抖动、网格识别都放在 ES Module Web Worker 里；转换可取消，过期结果会被丢弃 |
| 双算法对比 | 经典模式沿用既有实现；**保真模式**是新增实现：按覆盖面积和 alpha 加权取样，写实图在线性光空间取均值，用 Oklab 距离匹配最近珠色，合并颜色时限制误差增量。同一份像素数据送入两个独立 Worker 并排比较 |
| 品牌色板映射 | MARD / COCO / 漫漫 / 盼盼 / 咪小窝 共享 291 色跨品牌映射，外加 Artkal Mini C 独立色板；历史图纸按自身品牌加载，缺失时明确报错，不静默替换 |
| 图纸识别 | 用带方向的边缘轮廓检测网格周期，兼容粗网格线、非整数格距和裁剪偏移；无法确定时提示手动输入，而不是猜一个结果 |
| 本地数据安全 | IndexedDB 同时写两张表时用事务保证原子性，失败自动回滚；多标签同时编辑同一张图纸时，写入前比对基线版本，发现冲突就停止覆盖，并提供「另存副本 / 重新读取」 |
| 资源与边界 | 页面按路由懒加载，jsPDF 只在导出时加载；统一管理 Object URL 的回收；限制网格尺寸和导出画布像素，超限时提前给出说明 |

## 工程化

- TypeScript 严格模式，`npm run typecheck`
- 73 个单元测试（Node 内置 test runner），覆盖取样与量化核心、网格检测、色板、存储边界、保存冲突等，`npm test`
- GitHub Actions：每次推送依次执行类型检查、单元测试、构建，然后部署到 GitHub Pages

```bash
npm install
npm run dev      # 本地开发
npm run check    # 类型检查 + 单元测试 + 构建
```

## 技术栈

Vite 5 · React 18 · TypeScript · React Router 6 · Zustand · IndexedDB（idb）· Web Worker · Canvas · jsPDF

```text
src/
  pages/       首页、预处理、编辑器、图纸分析、空白画板设置
  components/  Canvas 渲染、工具栏、色板、算法对比、制作视图等
  workers/     图像处理与网格识别（ES Module Worker）
  utils/       存储、导出、色板、尺寸边界等纯函数
  store/       Zustand 编辑状态（含撤销重做）
  data/        品牌色板与跨品牌色号映射
docs/          产品需求、技术架构、算法实验与设计系统文档
```

## 关于这个 Demo

这是完整项目的精简演示版，为了能直接部署到 GitHub Pages，做了以下取舍：

- 去掉了模板创作工作台和基于 ONNX 模型的 AI 抠图，只保留纯色背景去除；
- 去掉了离线 Service Worker，路由改用 Hash 模式，以适配静态托管的子路径。

`docs/` 下的文档描述的是完整产品，其中会提到上面这些已移除的功能。

## 来源与许可

- 跨品牌色号映射数据来自 [Zippland/perler-beads](https://github.com/Zippland/perler-beads)（AGPL-3.0），详见 [src/data/NOTICE.md](src/data/NOTICE.md)。
- Oklab 转换采用 [Björn Ottosson 公开的定义](https://bottosson.github.io/posts/oklab/)。
- 示例图为本项目绘制。
- 本仓库以 [AGPL-3.0](LICENSE) 发布。
