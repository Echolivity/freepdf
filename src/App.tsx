import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './app/Layout'
import { Home } from './app/Home'
import { ToolPage } from './app/ToolPage'
import { Privacy } from './app/Privacy'
import { NotFound } from './app/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path=":slug" element={<ToolPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
