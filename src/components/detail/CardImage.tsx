import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../types/card'
import CardImg from '../CardImg'
import styles from './detail.module.css'

/** The large card image, with a full-screen viewer (native <dialog>: Esc and focus handled for us). */
export default function CardImage({ card }: { card: Card }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // The viewer's high-resolution image is only fetched once someone opens it
  const [viewerUsed, setViewerUsed] = useState(false)

  // Leaving the page with the viewer open (e.g. browser back) must not leave scrolling locked
  useEffect(() => () => void (document.documentElement.style.overflow = ''), [])

  // Keep the page behind the viewer from scrolling while it's open
  function open() {
    document.documentElement.style.overflow = 'hidden'
    setViewerUsed(true)
    dialogRef.current?.showModal()
  }

  // No image anywhere (data/missing-images.json): show the placeholder, nothing to zoom into
  if (!card.images.large && !card.images.fallbackLarge) {
    return (
      <div className={styles.imageColumn}>
        <CardImg className={styles.cardImage} src="" alt={`${card.name} 카드 이미지 없음`} />
      </div>
    )
  }

  return (
    <div className={styles.imageColumn}>
      <button type="button" className={styles.imageButton} onClick={open}>
        <CardImg
          className={styles.cardImage}
          src={card.images.large}
          fallback={card.images.fallbackLarge}
          alt={`${card.name} 카드 이미지`}
          width={734}
          height={1024}
          fetchPriority="high"
        />
      </button>
      <button type="button" className={styles.zoom} onClick={open}>
        이미지 크게 보기 ⤢
      </button>

      <dialog
        ref={dialogRef}
        className={styles.viewer}
        aria-label={`${card.name} 카드 이미지`}
        onClose={() => {
          document.documentElement.style.overflow = ''
        }}
        // A click on the backdrop (the dialog element itself, outside the image) closes it
        onClick={(event) => event.target === event.currentTarget && dialogRef.current?.close()}
      >
        {/* The viewer shows the original high-resolution image while it exists; our copy otherwise */}
        {viewerUsed && (
          <CardImg
            src={card.images.fallbackLarge ?? card.images.large}
            fallback={card.images.large}
            alt={`${card.name} 카드 이미지 (확대)`}
          />
        )}
        <form method="dialog">
          <button type="submit" className={styles.viewerClose} aria-label="닫기" autoFocus>
            ✕
          </button>
        </form>
      </dialog>
    </div>
  )
}
