import type { ReactNode } from 'react'
import styles from './CardGrid.module.css'

export default function CardGrid({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className={styles.grid} aria-busy={busy || undefined}>
      {children}
    </div>
  )
}
