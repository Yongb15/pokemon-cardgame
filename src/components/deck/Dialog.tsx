import { useEffect, useRef, type ReactNode } from 'react'
import styles from './deck.module.css'

interface Props {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}

/** A modal <dialog>: the browser handles focus trapping, Esc and the backdrop. Mount it to open it. */
export default function Dialog({ title, description, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      opener?.focus() // back to the button that opened it
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault() // Esc: let React unmount us instead of the browser closing behind its back
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose() // a click on the backdrop
      }}
    >
      <div className={styles.dialogBody}>
        <h2 id="dialog-title" className={styles.dialogTitle}>
          {title}
        </h2>
        {description && <p className={styles.dialogDesc}>{description}</p>}
        {children}
      </div>
    </dialog>
  )
}
