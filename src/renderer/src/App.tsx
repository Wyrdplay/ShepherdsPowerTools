import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from '@/components/Sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { pages } from '@/pages'
import { usePersistedState } from '@/lib/usePersistedState'

function App() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const [activePageId, setActivePageId] = usePersistedState<string>(
    'active-page',
    pages[0]?.id ?? ''
  )
  const [sidebarOpen, setSidebarOpen] = usePersistedState<boolean>('sidebar-open', true)

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0]
  const ActiveComponent = activePage?.component

  const handlePageSelect = (pageId: string) => {
    if (pageId === activePageId) {
      // Clicking the active page icon toggles the sidebar
      setSidebarOpen((prev) => !prev)
    } else {
      setActivePageId(pageId)
      if (!sidebarOpen) setSidebarOpen(true)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full w-full dark">
        {/* Sidebar */}
        <Sidebar
          pages={pages}
          activePageId={activePage?.id ?? ''}
          sidebarOpen={sidebarOpen}
          onPageSelect={handlePageSelect}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        {/* Main content area */}
        <main className="flex-1 min-w-0 bg-background">
          <ScrollArea className="h-full">
            {ActiveComponent && <ActiveComponent />}
          </ScrollArea>
        </main>
      </div>
    </TooltipProvider>
  )
}

export default App
