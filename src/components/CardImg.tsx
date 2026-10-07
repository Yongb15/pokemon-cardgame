import { useState, type ImgHTMLAttributes } from 'react'

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string
  /** Original image URL, used once if our self-hosted copy fails to load */
  fallback?: string
}

/** A card image that falls back to the original source if our hosted copy is missing. */
export default function CardImg({ src, fallback, onError, ...props }: Props) {
  // Track which src failed rather than a boolean, so a new card (new src) starts fresh
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const useFallback = fallback && failedSrc === src

  return (
    <img
      {...props}
      src={useFallback ? fallback : src}
      onError={(event) => {
        if (fallback && failedSrc !== src) setFailedSrc(src)
        onError?.(event)
      }}
    />
  )
}
