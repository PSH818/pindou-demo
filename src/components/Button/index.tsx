import { forwardRef, type ButtonHTMLAttributes } from 'react'

/**
 * 全局按钮基件 —— 所有可点击操作的默认选择。
 * 渲染原生 <button>（默认 type="button"），样式完全由 className 决定，
 * UA 默认样式由 app.scss 的全局 button reset 清除。
 *
 * 约定：简单操作用本组件；包含嵌套交互的复杂容器（如整行开关、卡片）
 * 才允许用 div + role="button"。禁止再新增 <div onClick> 伪按钮。
 */
const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function Button({ type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} {...rest} />
  }
)

export default Button
