import type { ColorEntry } from '../../utils/analyzePattern'
import './index.scss'

interface Props {
  entries:     ColorEntry[]
  patternName: string
  onExport:    () => void
}

export default function ColorTable({ entries, patternName, onExport }: Props) {
  const total = entries.reduce((s, e) => s + e.count, 0)

  return (
    <div className="ctable">
      <div className="ctable__header">
        <span className="ctable__title">用料清单</span>
        <span className="ctable__meta">{entries.length} 种颜色 · 共 {total.toLocaleString()} 粒</span>
      </div>

      <div className="ctable__scroll">
        <table className="ctable__table">
          <thead>
            <tr>
              <th className="ctable__th ctable__th--color">颜色</th>
              <th className="ctable__th ctable__th--code">色号</th>
              <th className="ctable__th ctable__th--name">名称</th>
              <th className="ctable__th ctable__th--count">数量</th>
              <th className="ctable__th ctable__th--pct">占比</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.colorId} className="ctable__row">
                <td className="ctable__td ctable__td--color">
                  <span
                    className="ctable__swatch"
                    style={{
                      background: `rgb(${e.rgb[0]},${e.rgb[1]},${e.rgb[2]})`,
                      outline: e.rgb[0] > 230 && e.rgb[1] > 230 && e.rgb[2] > 230
                        ? '1.5px solid #EDD0B8' : undefined,
                    }}
                  />
                </td>
                <td className="ctable__td ctable__td--code">{e.code}</td>
                <td className="ctable__td ctable__td--name">{e.name}</td>
                <td className="ctable__td ctable__td--count">{e.count.toLocaleString()}</td>
                <td className="ctable__td ctable__td--pct">
                  <div className="ctable__pct-wrap">
                    <span className="ctable__pct-num">{e.percent}%</span>
                    <div className="ctable__pct-bar">
                      <div
                        className="ctable__pct-fill"
                        style={{ width: `${e.percent}%`, background: `rgb(${e.rgb[0]},${e.rgb[1]},${e.rgb[2]})` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ctable__footer">
        <span className="ctable__total">合计 {total.toLocaleString()} 粒</span>
        <button type="button" className="ctable__export-btn" onClick={onExport}>
          导出 CSV
        </button>
      </div>
    </div>
  )
}
