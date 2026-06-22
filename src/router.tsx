import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ServerPickerPage } from '@/pages/ServerPickerPage'
import { ServerHomePage } from '@/pages/ServerHomePage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <ServerPickerPage /> },
      { path: '/server/:serverId', element: <ServerHomePage /> },
    ],
  },
])
