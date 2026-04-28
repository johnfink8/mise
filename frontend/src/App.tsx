import { Box, Container } from '@mui/material'
import { Route, Routes } from 'react-router-dom'

import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { LOBBY } from './theme'

export default function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: LOBBY.bg, color: LOBBY.text }}>
      <Container maxWidth="md" disableGutters sx={{ minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
        </Routes>
      </Container>
    </Box>
  )
}
