import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import FeedbackHost from './components/Feedback/FeedbackHost'
import './app.scss'

const IndexPage       = lazy(() => import('./pages/index/index'))
const PreprocessPage  = lazy(() => import('./pages/preprocess/index'))
const CanvasSetupPage = lazy(() => import('./pages/canvas-setup/index'))
const EditorPage      = lazy(() => import('./pages/editor/index'))
const AnalyzePage     = lazy(() => import('./pages/analyze/index'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Suspense fallback={<div className="app-loading">加载中…</div>}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/preprocess" element={<PreprocessPage />} />
          <Route path="/canvas-setup" element={<CanvasSetupPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/analyze" element={<AnalyzePage />} />
          <Route path="*" element={<IndexPage />} />
        </Routes>
        <FeedbackHost />
      </Suspense>
    </HashRouter>
  </React.StrictMode>
)
