import { X as XIcon } from 'lucide-preact'

interface IntroModalProps {
  show: boolean
  onDismiss: () => void
}

export const IntroModal = ({ show, onDismiss }: IntroModalProps) => {
  if (!show) return null

  return (
    <div className='absolute inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-500'>
      <div className='max-w-2xl w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden'>
        <div className='flex justify-between items-start p-6 md:p-8 pb-0 shrink-0'>
          <h1 className='text-3xl md:text-4xl font-black bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent'>
            HOW TO PLAY
          </h1>
          <button
            onClick={onDismiss}
            className='p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white cursor-pointer'
          >
            <XIcon className='w-6 h-6' />
          </button>
        </div>

        <div className='p-6 md:p-8 overflow-y-auto flex-1 text-slate-300 leading-relaxed custom-scrollbar'>
          <p className='text-lg mb-6'>
            This is{' '}
            <span className='text-cyan-400 font-bold'>
              Recursive Tic-Tac-Toe
            </span>
            . Each cell contains a smaller board, and each of those contains
            even smaller boards, down to 4 levels of depth.
          </p>

          <div className='grid md:grid-cols-2 gap-6'>
            <div className='bg-slate-800/50 p-4 rounded-xl border border-slate-700/50'>
              <h3 className='text-white font-bold mb-2 flex items-center gap-2'>
                <span className='w-2 h-2 rounded-full bg-cyan-400' />
                Rules
              </h3>
              <ul className='space-y-2 text-sm'>
                <li>
                  • Win a local board to claim that cell in the grid above.
                </li>
                <li>
                  • Your move sends the opponent to a specific sector in the
                  next turn (highlighted in gold).
                </li>
                <li>
                  • If a target board is full or already won, you can play
                  anywhere.
                </li>
              </ul>
            </div>

            <div className='bg-slate-800/50 p-4 rounded-xl border border-slate-700/50'>
              <h3 className='text-white font-bold mb-2 flex items-center gap-2'>
                <span className='w-2 h-2 rounded-full bg-purple-500' />
                Controls
              </h3>
              <ul className='space-y-2 text-sm'>
                <li>
                  • <span className='text-white font-bold'>Scroll</span> to zoom
                  in/out.
                </li>
                <li>
                  •{' '}
                  <span className='text-white font-bold'>
                    Right-Click + Drag
                  </span>{' '}
                  to pan.
                </li>
                <li>
                  • <span className='text-white font-bold'>Left-Click</span> to
                  place your mark.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className='p-6 md:p-8 pt-4 border-t border-slate-800 flex justify-end shrink-0 bg-slate-900 z-10'>
          <button
            onClick={onDismiss}
            className='bg-white text-slate-900 px-8 py-3 rounded-xl font-bold hover:bg-cyan-50 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)] active:scale-95 transform cursor-pointer'
          >
            Okay
          </button>
        </div>
      </div>
    </div>
  )
}
