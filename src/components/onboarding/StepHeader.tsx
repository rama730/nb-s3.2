import { cn } from '@/lib/utils'

interface StepHeaderProps {
  title: string
  subtitle: string
}

export function StepHeader({ title, subtitle }: StepHeaderProps) {
  return (
    <div
      className={cn('mb-8 text-left outline-none')}
      data-step-header
      tabIndex={-1}
    >
      <h1 className={cn('text-[24px] font-semibold leading-[1.3] text-foreground')}>
        {title}
      </h1>
      <p className={cn('mt-1 text-[14px] font-normal leading-[1.5] text-muted-foreground')}>
        {subtitle}
      </p>
    </div>
  )
}
