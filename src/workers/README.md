# workers/

Web Worker 线程文件目录。图片转图纸和图纸识别的 CPU 密集计算在此运行，避免阻塞界面。

## 关键约束

- 活跃 Worker 必须使用 ES Module（`import` / `export`）。
- 由 Vite 通过 `new URL(..., import.meta.url)` 打包，创建时使用 `{ type: 'module' }`。
- 不访问 `document`、`window` 或 Canvas DOM。
- 消息协议由 `src/types/index.ts` 定义，主线程必须验证 Worker 返回值。
- `imageProcessor.js`、`dither.js`、`colorMatch.js` 的图片转拼豆算法为冻结区，禁止改变算法输出。

## 文件说明

| 文件 | 职责 | 状态 |
|------|------|------|
| `imageProcessor.js` | 图片转拼豆 Worker 入口 | 活跃、算法冻结 |
| `colorMatch.js` | LAB / CIEDE2000 颜色匹配 | 活跃、算法冻结 |
| `dither.js` | Floyd-Steinberg 抖动 | 活跃、算法冻结 |
| `gridDetect.js` | 已有图纸的网格与色号识别 | 活跃 |
| `interpolate.js` | 历史插值实现 | 未接入 |
| `octree.js` | 历史 Octree 实现 | 未接入 |

详细消息协议和维护约束见同目录 `CLAUDE.md`。
