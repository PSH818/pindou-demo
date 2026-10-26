# data/

浏览器本地使用的拼豆色板 JSON，由 `src/utils/palette.ts` 按品牌动态加载或投影。

| 文件 | 品牌 | 说明 |
|------|------|------|
| `mard.json` | 国产品牌共享基准色板 | 291 个 RGB 基准色及 MARD / COCO / 漫漫 / 盼盼 / 咪小窝色号映射 |
| `artkal_c.json` | Artkal Mini C | 2.6 mm 色板 |
| `colorSystemMapping.json` | 上游原始色号映射 | 用于来源核验，不在运行时重复加载 |
| `NOTICE.md` | 数据来源声明 | 上游版本、许可证与已知数据例外 |

MARD、COCO、漫漫、盼盼、咪小窝作为独立品牌入口，共享同一套 RGB 基准，只投影为各自色号；Artkal C 使用独立色板。每个颜色包含稳定 `id`、色号、名称、RGB 与预计算 LAB。

来源和授权信息见 [NOTICE.md](NOTICE.md)。新增独立色板品牌时必须同时增加 JSON、`BRAND_IDS`、加载元数据、界面入口和文档，不得只增加品牌枚举。
