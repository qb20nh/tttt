import type { LucideIcon } from 'lucide-react'

interface GameModeButtonProps {
  label: string
  description: string
  icon: LucideIcon
  color: 'cyan' | 'rose' | 'purple'
  onClick?: () => void
  href?: string
  onNavigate?: (path: string) => void
  onMouseEnter?: () => void
}

const colorStyles = {
  cyan: {
    icon: 'text-cyan-400',
    border: 'group-hover:border-cyan-500/50',
    gradient: 'from-cyan-500/10',
  },
  rose: {
    icon: 'text-rose-500',
    border: 'group-hover:border-rose-500/50',
    gradient: 'from-rose-500/10',
  },
  purple: {
    icon: 'text-purple-500',
    border: 'group-hover:border-purple-500/50',
    gradient: 'from-purple-500/10',
  },
}

export const GameModeButton = ({
  label,
  description,
  icon: Icon,
  color,
  onClick,
  href,
  onNavigate,
  onMouseEnter,
}: GameModeButtonProps) => {
  const styles = colorStyles[color]

  const content = (
    <div
      className={`
        bg-slate-900/50 border border-slate-800 p-6 md:p-8 pt-8 md:pt-12 rounded-2xl
        transition-[transform,colors,border-color,background-color] duration-200
        group-hover:-translate-y-1 group-hover:bg-slate-800
        ${styles.border}
        h-full flex flex-col items-center justify-start
      `}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${styles.gradient} to-transparent opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity`}
      />
      <Icon
        className={`w-10 h-10 md:w-12 md:h-12 ${styles.icon} mb-3 md:mb-4 group-hover:scale-110 transition-transform`}
        width={40}
        height={40}
      />
      <h3 className='text-xl md:text-2xl font-bold text-white mb-2'>
        {label}
      </h3>
      <p className='text-slate-400 text-sm'>{description}</p>
    </div>
  )

  if (href) {
    return (
      <a
        href={href}
        onClick={(e) => {
          if (onNavigate) {
            e.preventDefault()
            onNavigate(href)
          }
          onClick?.()
        }}
        onMouseEnter={onMouseEnter}
        className='group relative w-full h-full focus:outline-none cursor-pointer block'
      >
        {content}
      </a>
    )
  }

  return (
    <button
      onClick={onClick}
      className='group relative w-full h-full focus:outline-none cursor-pointer'
    >
      {content}
    </button>
  )
}
