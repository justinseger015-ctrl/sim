import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { getBlock } from '@/blocks'

export enum TriggerWarningType {
  DUPLICATE_TRIGGER = 'duplicate_trigger',
  LEGACY_INCOMPATIBILITY = 'legacy_incompatibility',
}

interface TriggerWarningDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerName: string
  type: TriggerWarningType
  blockType?: string
}

export function TriggerWarningDialog({
  open,
  onOpenChange,
  triggerName,
  type,
  blockType,
}: TriggerWarningDialogProps) {
  // Determine if this is a trigger block or regular block
  const isTriggerBlock = blockType ? getBlock(blockType)?.category === 'triggers' : true
  const blockOrTrigger = isTriggerBlock ? 'trigger' : 'block'

  const getTitle = () => {
    switch (type) {
      case TriggerWarningType.LEGACY_INCOMPATIBILITY:
        return 'Cannot mix trigger types'
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return `Only one ${triggerName} ${blockOrTrigger} allowed`
    }
  }

  const getDescription = () => {
    switch (type) {
      case TriggerWarningType.LEGACY_INCOMPATIBILITY:
        return 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
      case TriggerWarningType.DUPLICATE_TRIGGER:
        return `A workflow can only have one ${triggerName} ${blockOrTrigger}. Please remove the existing one before adding a new one.`
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{getTitle()}</AlertDialogTitle>
          <AlertDialogDescription>{getDescription()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
