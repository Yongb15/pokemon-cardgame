import { useEffect, useRef } from 'react'
import type { Card } from '../../types/card'
import styles from './detail.module.css'

/** The large card image, with a full-screen viewer (native <dialog>: Esc and focus handled for us). */
export default function CardImage({ card }: { card: Card }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Leaving the page with the viewer open (e.g. browser back) must not leave scrolling locked
  useEffect(() => () => void (document.documentElement.style.overflow = ''), [])

  // Keep the page behind the viewer from scrolling while it's open
  function open() {
    document.documentElement.style.overflow = 'hidden'
    dialogRef.current?.showModal()
  }

  return (
    <div className={styles.imageColumn}>
      <button type="button" className={styles.imageButton} onClick={open}>
        <img
          className={styles.cardImage}
          src={card.images.large}
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
        <img src={card.images.large} alt={`${card.name} 카드 이미지 (확대)`} />
        <form method="dialog">
          <button type="submit" className={styles.viewerClose} aria-label="닫기" autoFocus>
            ✕
          </button>
        </form>
      </dialog>
    </div>
  )
}
