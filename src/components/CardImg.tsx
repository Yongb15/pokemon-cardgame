import { useState, type ImgHTMLAttributes } from 'react'
import styles from './CardImg.module.css'

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string
  /** Original image URL, used once if our self-hosted copy fails to load */
  fallback?: string
}

/**
 * A card image that falls back to the original source if our hosted copy is missing, and to a
 * "no image" placeholder if that fails too (a few cards have no image anywhere).
 */
export default function CardImg({ src, fallback, onError, className, alt, ...props }: Props) {
  // Remember which src the failures belong to, so a new card (new src) starts fresh
  const [failed, setFailed] = useState<{ src: string; count: number } | null>(null)
  const failures = failed?.src === src ? failed.count : 0
  // Hosted copy, then the original; an empty src means the card has no image at all
  const candidates = [src, fallback].filter(Boolean) as string[]
  const current = candidates[failures]

  if (!current) {
    return (
      <span className={className ? `${className} ${styles.missing}` : styles.missing} role="img" aria-label={alt || '이미지 없음'}>
        이미지 없음
      </span>
    )
  }

  return (
    <img
      {...props}
      className={className}
      alt={alt}
      src={current}
      onError={(event) => {
        setFailed({ src, count: failures + 1 })
        onError?.(event)
      }}
    />
  )
}
