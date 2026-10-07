import type { ReactNode } from 'react'
import styles from './Select.module.css'

interface Props {
  id: string
  label: string
  /** Show the label inside the box ("정렬 번호순") instead of in front of it */
  inlineLabel?: boolean
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: ReactNode
}

export default function Select({ id, label, inlineLabel, value, onChange, disabled, children }: Props) {
  return (
    <div className={inlineLabel ? `${styles.field} ${styles.inline}` : styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </div>
  )
}
