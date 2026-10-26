# 拼豆图纸设计工具 技术架构文档

**版本：** v2.0  
**日期：** 2026-07-06  
**对应 PRD：** v2.0

---

## 目录

1. [技术选型](#1-技术选型)
2. [系统架构](#2-系统架构)
3. [模块划分](#3-模块划分)
4. [核心数据模型](#4-核心数据模型)
5. [核心算法方案](#5-核心算法方案)
6. [存储方案](#6-存储方案)
7. [渲染方案](#7-渲染方案)
8. [导出方案](#8-导出方案)
9. [成本结构](#9-成本结构)
10. [包体积规划](#10-包体积规划)
11. [性能指标与测试基准](#11-性能指标与测试基准)
12. [风险清单](#12-风险清单)

---

## 1. 技术选型

### 1.1 框架：Vite 5 + React + TypeScript

纯 Web 应用，浏览器直接访问，无需安装。

| 维度 | 选型 | 说明 |
|------|------|------|
| 构建工具 | Vite 5 | 开发热更新快，ESM 原生支持，Worker 打包零配置 |
| UI 框架 | React 18 | 组件生态丰富，Concurrent Mode 支持 |
| 类型系统 | TypeScript | 对 `Uint16Array` 颜色矩阵等复杂数据结构的类型约束最优 |
| 路由 | React Router v6 | 标准 Web 路由 |
| 状态 | Zustand 4 | 轻量，适合当前状态结构 |

### 1.2 核心依赖

| 依赖 | 版本 | 用途 | 引入时机 |
|------|------|------|----------|
| `react` | 18.x | UI 框架 | 初始 bundle |
| `react-router-dom` | 6.x | 页面路由 | 初始 bundle |
| `zustand` | 4.x | 状态管理 | 初始 bundle |
| `idb` | 7.x | IndexedDB 封装 | 初始 bundle |
| `nanoid` | 4.x | 唯一 ID 生成 | 初始 bundle |
| `jspdf` | 2.x | PDF 生成（客户端） | 动态 import，导出时懒加载 |

### 1.3 不引入的依赖

| 放弃的包 | 原因 |
|----------|------|
| Redux / MobX | 状态结构简单，Zustand 足够 |
| 图像处理 npm 包（jimp 等） | Worker 内只能 import 相对路径文件，改为手写 |
| remove.bg SDK | 改用客户端 ONNX 模型，零 API 费用（二期） |
| 后端 SDK / 云函数 | 产品完全免费无登录，无需任何服务端 |

---

## 2. 系统架构

### 2.1 整体架构

所有计算和存储均在客户端完成，零服务端依赖。

```
┌──────────────────────────────────────────────────────────────┐
│                         浏览器（客户端）                        │
│                                                                │
│  ┌────────────────┐   ┌──────────────────────────────────┐   │
│  │   主线程（UI）  │   │         Web Worker 线程           │   │
│  │                │   │                                   │   │
│  │  React 组件树   │◄─►│  imageProcessor.js（图像转换）    │   │
│  │  Canvas 渲染   │   │  ├── colorMatch.js（色板映射）     │   │
│  │  用户交互响应   │   │  └── dither.js（误差扩散）         │   │
│  │                │   │                                   │   │
│  └───────┬────────┘   └──────────────────────────────────┘   │
│          │                                                     │
│  ┌───────▼────────────────────────────────────────────────┐  │
│  │                    本地持久层                            │  │
│  │  IndexedDB（图纸数据）  +  Cache API（ONNX 模型，二期） │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              静态资源（打包进 bundle）                     │ │
│  │  色板 JSON × 2（6 个品牌入口） + 字体 + 图标             │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
             无服务端请求——全部功能离线可用
```

### 2.2 页面路由

```
/              首页：历史图纸列表 + 新建入口
/preprocess    图片裁剪与可选背景去除
/canvas-setup  空白画板设置
/editor        图纸编辑器（query: patternId / imagePath / mode）
/analyze       已有图纸识别与用料分析
```

### 2.3 数据流

```
用户上传图片
      │
      ▼
主线程：读取为 ImageData（Canvas API）
      │
      │ postMessage(imageData, params, palette)
      ▼
Worker 线程：
  ① 缩放至目标格数（面积平均降采样）
  ② 构建 5-bit RGB LUT（颜色查找表）
  ③ 格子映射（dominant / average 模式）
  ④ 全局频率优先颜色合并
  ⑤ 收紧 palette
  ⑥ Floyd-Steinberg 抖动（可选）
      │
      │ postMessage(gridData: Uint16Array)
      ▼
主线程：
  ⑦ 更新 Zustand store（patternStore）
  ⑧ Canvas 渲染图纸
  ⑨ 保存到 IndexedDB
```

---

## 3. 模块划分

### 3.1 目录结构

```
src/
├── app.scss                  全局样式
│
├── pages/
│   ├── index/                首页
│   │   ├── index.tsx
│   │   └── index.scss
│   └── editor/               图纸编辑器
│       ├── index.tsx
│       └── index.scss
│
├── components/               复用组件
│   ├── PatternCanvas/        图纸 Canvas 渲染
│   │   ├── index.tsx
│   │   ├── index.scss
│   │   └── renderer.ts       纯渲染逻辑（无 React 依赖）
│   ├── ColorPanel/           颜色面板（双标签：图纸已用色 / 品牌全色板）
│   ├── MaterialList/         用料清单
│   └── ToolBar/              编辑工具栏
│
├── workers/                  Web Worker 文件（ES Module，Vite 打包）
│   ├── imageProcessor.js     Worker 入口，消息调度
│   ├── colorMatch.js         CIEDE2000 颜色匹配
│   ├── dither.js             Floyd-Steinberg 抖动
│   ├── octree.js             Octree 量化（遗留，未接入主流程）
│   └── interpolate.js        双三次插值（遗留，未接入主流程）
│
├── data/                     品牌色板数据（打包进 bundle）
│   ├── mard.json
│   ├── artkal_c.json
│
├── store/                    Zustand 状态管理
│   └── patternStore.ts       当前图纸状态 + 撤销/重做
│
├── hooks/                    自定义 React Hooks
│   └── usePattern.ts         图纸转换流程编排（Worker 生命周期）
│
├── utils/                    工具函数
│   ├── colorUtils.ts         RGB ↔ LAB 转换，CIEDE2000 计算
│   ├── canvasHelper.ts       Canvas 节点获取封装
│   ├── storage.ts            IndexedDB 读写封装（idb）
│   ├── export.ts             PNG 导出
│   ├── exportPDF.ts          PDF 导出（含 jsPDF，动态 import）
│   ├── palette.ts            色板数据加载与管理
│   └── webUtils.ts           Web 通用工具（toast、文件下载、图片选择）
│
└── types/
    └── index.ts              全局类型定义
```

### 3.2 模块职责说明

| 模块 | 职责 | 关键约束 |
|------|------|----------|
| `workers/` | 所有 CPU 密集型计算 | ES Module，只能 import 相对路径文件，不能 import npm 包 |
| `store/` | 运行时状态（当前图纸、工具状态） | 不持久化到 storage（由 hooks 负责） |
| `utils/storage.ts` | IndexedDB 读写 | 统一数据版本管理，调用方不直接使用 idb |
| `components/PatternCanvas` | 图纸渲染，响应 store 变化 | 不直接操作 store，通过 props 接收 |
| `utils/colorUtils.ts` | 颜色空间转换 | 同时被主线程和 Worker 使用，不能有浏览器 API 依赖 |
| `utils/exportPDF.ts` | PDF 导出 | 含 jsPDF，**必须动态 import**，禁止静态 import（避免 bundle 膨胀） |

---

## 4. 核心数据模型

```typescript
// src/types/index.ts

interface BeadColor {
  id: number                      // 在色板中的顺序索引（0-based）
  code: string                    // 厂商色号，如 "C01"
  name: string                    // 中文色名，如 "白色"
  rgb: [number, number, number]   // sRGB，0~255
  lab: [number, number, number]   // CIELAB，预计算，避免运行时重复转换
}

type BrandId = 'mard' | 'artkal_c'

interface Pattern {
  id: string                      // nanoid 8 位
  name: string
  width: number                   // 列数（格）
  height: number                  // 行数（格）
  brandId: BrandId
  paletteUsed: number[]           // 本图纸用到的颜色 id 列表
  grid: Uint16Array               // 扁平化，长度 = width * height
                                  // 值为 paletteUsed 中的下标（0-based）
                                  // 0xFFFF 表示透明（不放珠）
  thumbnail: string               // base64 PNG，64×64，列表缩略图
  createdAt: number               // Unix timestamp (ms)
  updatedAt: number
}

interface ConvertParams {
  width: number
  height: number
  brandId: BrandId
  maxColors: number               // 最大用色数，2~30
  dithering: boolean
  mergeThreshold: number          // 颜色合并 RGB 距离阈值，0~100
}

type EditTool = 'brush' | 'fill' | 'eyedropper' | 'eraser'
```

**存储体积估算：**

```
29×29 图纸：  grid = 29 × 29 × 2 bytes ≈ 1.6 KB
100×100 图纸：grid = 100 × 100 × 2 bytes = 20 KB
50 张图纸（含缩略图 ~3KB/张）：≈ 50 × 23 KB = ~1.1 MB（极限情况）
```

---

## 5. 核心算法方案

### 5.1 图像缩放：面积平均降采样

**选择原因：** 保留每格内像素的整体颜色信息，对拼豆这类需要将区域颜色映射到单一珠子的场景最自然。

**执行位置：** Worker 线程

### 5.2 颜色量化：5-bit RGB LUT

**选择原因：** 比 Octree / K-Means 更快。将 RGB 各通道压缩到 32 级，预计算 32³ = 32768 个 bucket，每格映射只需 O(1) 查表。

**执行位置：** Worker 线程

```
流程：
  1. 将品牌色板每种颜色映射到 5-bit bucket（构建 LUT，仅初始化一次）
  2. 每个目标格子：
     - dominant 模式：取格内最高频 bucket，查 LUT 得珠子 ID
     - average 模式：格内像素 RGB 均值，查 LUT 得珠子 ID
  3. 透明判定：格内不透明像素（alpha ≥ 128）< 50% → 标为 0xFFFF
```

### 5.3 颜色合并：全局频率优先

**目的：** 减少实际用到的珠子色种数，降低制作难度。

```
流程：
  1. 统计每种珠子色的使用格数
  2. 按频率从高到低排序
  3. 对每对颜色，若 RGB 欧氏距离 < mergeThreshold，低频色全局替换为高频色
```

### 5.4 颜色匹配：CIEDE2000

**选择原因：** RGB 欧氏距离对人眼感知误差大（蓝色区域尤其明显），CIEDE2000 在 LAB 色空间计算，与人眼感知高度一致。

**执行位置：** Worker 线程（Floyd-Steinberg 抖动步骤中逐格使用）

### 5.5 抖动：Floyd-Steinberg 误差扩散

**适用场景：** 用户开启抖动选项时，改善渐变区域表现（如肤色、天空）。

```
已处理 → [当前] →  7/16
          ↙  ↓  ↘
        3/16 5/16 1/16
```

不会增加新颜色，只在现有 paletteUsed 范围内选最优。

### 5.6 背景去除（二期，客户端推理）

**模型：** MODNet（MobileNetV2 骨干，ONNX 格式，fp16 约 14MB）  
**运行时：** ONNX Runtime Web（WASM backend）  
**下载策略：** 首次使用时从 CDN 下载，Cache API 持久化缓存

```
推理流程：
  1. 检查 Cache API 中是否已有模型文件
  2. 若无：下载 ~14MB 模型，存入 Cache API（显示进度）
  3. 加载 InferenceSession（input: 'input'，output: 'output'）
  4. 预处理：resize 至宽高均为 32 的倍数，归一化到 [-1, 1]（mean=0.5，std=0.5）
  5. 推理：输出 (1,1,H,W) alpha matte，值域 [0,1]
  6. 后处理：resize 还原到原图尺寸，应用到原图 alpha 通道
  7. 返回去背后的 ImageData
```

**与 RMBG-1.4 的选型差异：**
- MODNet 7M 参数（MobileNetV2），WASM 推理内存约 28MB（fp32）/ 14MB（fp16）
- RMBG-1.4 为 44M 参数，WASM 内存约 176MB，低端设备难以承受
- MODNet 支持动态分辨率（不强制 1024×1024），官方提供 ONNX 导出脚本
- Apache 2.0 协议，无商用限制

---

## 6. 存储方案

### 6.1 IndexedDB 结构

```
数据库名：pindou，版本：1

Object Store: patterns
  keyPath: 'id'
  存储：完整 Pattern，含 Uint16Array grid（结构化克隆原生支持）

Object Store: meta
  keyPath: 'id'
  存储：PatternMeta（不含 grid），用于列表快速读取

Object Store: settings
  keyPath：无（out-of-line key）
  存储：任意设置键值对
```

### 6.2 读写策略

| 操作 | 时机 | 说明 |
|------|------|------|
| 写入图纸 | 转换完成后 + 编辑后 debounce 2s | patterns + meta 同一事务 |
| 读取列表 | 首页加载时 | 只读 meta store，不加载 grid |
| 读取图纸 | 进入编辑器时 | 读完整 patterns（含 grid） |
| 删除图纸 | 用户主动删除 | patterns + meta 同一事务 |
| 容量检查 | 每次写入前 | meta store count，超过 50 提示 |

---

## 7. 渲染方案

### 7.1 Canvas 节点获取

```typescript
// utils/canvasHelper.ts
// 通过 querySelector 获取，在 useEffect 挂载后调用
export function getCanvas(selector: string): HTMLCanvasElement | null {
  return document.querySelector(selector)
}
```

### 7.2 RenderOptions（renderer.ts 驱动参数）

```typescript
interface RenderOptions {
  scale: number              // px/格
  offsetX: number
  offsetY: number
  showGrid: boolean
  circular: boolean          // 圆形珠子模拟
  highlightColorIdx: number | null
  showColorCode: boolean     // 格子内色号（scale ≥ 20 时有效）
  showGuideLines?: boolean   // 分组划线
  guideLinesEvery?: 5 | 10   // 划线间隔格数
  guideLinesColor?: string   // 划线颜色
}
```

### 7.3 渲染层次

```
renderFull() 绘制顺序：
  1. background（背景色填充）
  2. cells（珠子颜色，圆形或方形）
  3. grid（网格线）
  4. guideLines（分组划线，叠加在网格之上）
  5. colorCodes（格子内色号）
  6. highlight（颜色高亮遮罩）
  7. ruler（标尺，仅导出时）
```

### 7.4 大尺寸图纸性能优化

- **批量绘制**：同色格子统一 fillStyle，一次性绘制，避免频繁切换
- **脏矩形更新**：编辑时只重绘被修改的格子区域，不全量重绘

---

## 8. 导出方案

### 8.1 PNG 导出（export.ts）

```
方案：离屏 Canvas（document.createElement('canvas')）→ toBlob → 浏览器下载
全程本地，零网络请求，零费用
```

**导出尺寸：**

| 规格 | 每格像素 | 29×29 成品尺寸 |
|------|----------|----------------|
| 标准 | 16px | 464 × ~500px |
| 高清 | 48px | 1392 × ~1500px |

（高度含图例、标尺区域）

### 8.2 PDF 导出（exportPDF.ts）

```
方案：jsPDF（客户端，动态 import 懒加载）
全程本地，零网络请求，零费用

// 调用方
const { exportPatternToPDF } = await import('../../utils/exportPDF')
```

**页面规划：**
- 第 1 页：图纸（A4，等比居中，留白 10mm 边距）
- 第 2 页：用料清单（表格，色块 + 色号 + 色名 + 数量）

---

## 9. 成本结构

**服务端成本：¥0（永久）**

所有计算和存储均在客户端完成，无任何服务端部署：

```
图片读取 → 颜色量化 → 色板映射 → 图纸渲染 → PNG/PDF 导出
             全部在浏览器本地运行，不上传用户图片
```

应用壳和已访问的构建资源由 `public/sw.js` 缓存；MODNet 模型首次使用时从静态站点或配置的 CDN 下载并单独缓存。静态托管必须配置 SPA 回退与 COOP/COEP 响应头。

**唯一的运营成本：** 静态文件托管（CDN/对象存储），通常月费个位数甚至免费（Vercel / Cloudflare Pages 免费额度）。

---

## 10. 包体积规划

### 10.1 初始 bundle（首屏加载）

| 资源 | 估算体积 | 说明 |
|------|----------|------|
| React + ReactDOM | ~130 KB | gzip 后 ~45 KB |
| React Router | ~15 KB | |
| 业务代码（首页）| ~80 KB | |
| 品牌色板 JSON × 2 | 按需分包 | 国产五品牌共享基准映射 / Artkal C 独立色板 |
| zustand + idb | ~20 KB | |
| **当前实测入口** | **~165 KB** | gzip 后约 54 KB（2026-07-17） |

### 10.2 懒加载（编辑器页）

| 资源 | 估算体积 | 说明 |
|------|----------|------|
| 编辑器业务代码 | ~200 KB | 含所有组件 |
| Worker 文件 × 3 | ~20 KB | Vite 独立打包 |

### 10.3 按需加载

| 资源 | 体积 | 触发时机 |
|------|------|----------|
| jsPDF | ~300 KB | 用户点击「导出 PDF」 |
| ONNX Runtime JS + WASM | ~11.7 MB | 用户首次点击背景去除 |
| 背景去除模型（MODNet fp16） | ~13 MB | 同上，Cache API 缓存 |

---

## 11. 性能指标与测试基准

| 指标 | 目标值 | 备注 |
|------|--------|------|
| 29×29 图纸转换（全流程） | ≤ 3s | 中端 Android Chrome |
| 100×100 图纸转换 | ≤ 10s | 同上 |
| 编辑器打开（已有图纸） | ≤ 500ms | IndexedDB 读取 + Canvas 渲染 |
| 单格涂色响应 | ≤ 16ms（60fps）| 脏矩形更新 |
| 导出 PNG（29×29 标准） | ≤ 1s | 离屏 Canvas |
| 导出 PDF | ≤ 5s | jsPDF + 动态加载 |
| 背景去除（模型已缓存） | ≤ 3s | 二期，ONNX WASM |

---

## 12. 风险清单

| 风险 | 严重度 | 概率 | 应对方案 |
|------|--------|------|----------|
| Worker ES Module 在旧版浏览器不支持 | 中 | 低 | 目标浏览器 Chrome 90+ / Firefox 90+ / Safari 15+ 均原生支持；低版本展示提示页 |
| Worker 内无法 import npm 包 | 高 | 已确认 | 所有 Worker 算法手写纯 JS，只 import 相对路径文件 |
| WASM 在 Worker 内加载失败（二期） | 中 | 中 | ONNX Runtime WASM 模式失败时降级到主线程运行 |
| 低端 Android 颜色量化超时 | 中 | 低 | Worker 内进度上报；超过 15s 展示取消按钮 |
| jsPDF 中文字体乱码 | 低 | 高（已知） | 内嵌字体子集，或改用 Canvas 绘制文字后嵌入 PDF |
| IndexedDB 被浏览器清理（隐私模式） | 低 | 中 | 隐私模式下提示用户数据不持久化，导出前保存 |
| 大尺寸图纸（200×200）Canvas 内存溢出 | 中 | 低 | 导出前检查尺寸，超过安全值时提示降低分辨率 |
