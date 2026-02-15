import { cn } from '@/lib/utils'
import { type Page } from '@/pages'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

interface SidebarProps {
  pages: Page[]
  activePageId: string
  sidebarOpen: boolean
  onPageSelect: (pageId: string) => void
  onToggleSidebar: () => void
}

export function Sidebar({
  pages,
  activePageId,
  sidebarOpen,
  onPageSelect,
  onToggleSidebar
}: SidebarProps) {
  return (
    <div className="flex h-full select-none">
      {/* Activity Bar — icon rail (always visible) */}
      <div className="flex flex-col items-center w-12 bg-sidebar-background border-r border-sidebar-border py-2 gap-1">
        {pages.map((page) => {
          const Icon = page.icon
          const isActive = page.id === activePageId
          return (
            <Tooltip key={page.id} delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onPageSelect(page.id)}
                  className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-md transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {page.label}
              </TooltipContent>
            </Tooltip>
          )
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Toggle sidebar button */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleSidebar}
              className="flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-5 w-5" />
              ) : (
                <PanelLeftOpen className="h-5 w-5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Sidebar panel (collapsible) */}
      <div
        className={cn(
          'bg-sidebar-background border-r border-sidebar-border overflow-hidden transition-all duration-200 ease-in-out',
          sidebarOpen ? 'w-52' : 'w-0'
        )}
      >
        <div className="w-52 p-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            Tools
          </h2>
          <nav className="flex flex-col gap-0.5">
            {pages.map((page) => {
              const Icon = page.icon
              const isActive = page.id === activePageId
              return (
                <button
                  key={page.id}
                  onClick={() => onPageSelect(page.id)}
                  className={cn(
                    'flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors text-left',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{page.label}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
