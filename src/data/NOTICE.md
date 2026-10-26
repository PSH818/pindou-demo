# 色号映射数据来源声明

`colorSystemMapping.json` 及由它生成的 `mard.json` 多品牌色号映射参考自：

- 项目：`Zippland/perler-beads`
- 来源文件：`src/app/colorSystemMapping.json`
- 上游提交：`2efee730f73dd4eb472ebde443a022d11f98bc21`
- 仓库：https://github.com/Zippland/perler-beads
- 许可证：GNU Affero General Public License v3.0

许可证全文见 `UPSTREAM_LICENSE.Zippland-AGPL-3.0.txt`。本项目只复用色号对应数据，未引入上游图像处理算法。

## 数据语义

- 映射表以 291 个 RGB 基准色为键，提供 MARD、COCO、漫漫、盼盼、咪小窝色号。
- 这些 RGB 是跨品牌色号映射的共享基准，不应宣称为每个厂商珠子的独立实测色值。
- 漫漫有 1 个 `-` 缺失映射，因此可选色为 290 个；上游另有 `S4` 对应两个基准色，按来源数据原样保留。
