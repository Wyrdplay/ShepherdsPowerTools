import { type LucideIcon } from 'lucide-react'
import { DoorCalculator } from './DoorCalculator'
import { DoorOpen } from 'lucide-react'

export interface Page {
  id: string
  label: string
  icon: LucideIcon
  component: React.FC
}

/**
 * Page registry — add new pages here.
 * Each entry will automatically appear in the sidebar navigation.
 */
export const pages: Page[] = [
  {
    id: 'door-calculator',
    label: 'Door Calculator',
    icon: DoorOpen,
    component: DoorCalculator
  }
  // Add more pages here as needed:
  // {
  //   id: 'my-new-page',
  //   label: 'My New Page',
  //   icon: SomeIcon,
  //   component: MyNewPageComponent
  // }
]
