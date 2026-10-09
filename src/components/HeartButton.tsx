import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { rememberHeart, toggleFavorite, useFavorites } from '../hooks/useFavorites'
import { useSession } from '../hooks/useSession'
import styles from './HeartButton.module.css'

export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * "♡ 관심 카드" on the card detail page (docs/design/favorites.webp). Signed out, it goes to the
 * sign-in page and the heart is saved on the way back. A failed save is undone and said aloud.
 */
export default function HeartButton({ cardId, cardName }: { cardId: string; cardName: string }) {
  const session = useSession()
  const favorites = useFavorites()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [error, setError] = useState<string | null>(null)
  const on = favorites.status === 'ready' && favorites.ids.includes(cardId)
  // Until we know who's signed in (or their hearts are loaded), the button waits
  const waiting = session.status === 'unknown' || (session.status === 'in' && favorites.status !== 'ready' && favorites.status !== 'error')

  const onClick = async () => {
    setError(null)
    if (session.status !== 'in') {
      rememberHeart(cardId)
      navigate(`/login?${new URLSearchParams({ next: pathname + search })}`)
      return
    }
    const failed = await toggleFavorite(cardId)
    if (failed) setError(failed)
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.heart}
        aria-pressed={on}
        aria-label={on ? `${cardName} 관심 카드에서 빼기` : `${cardName} 관심 카드에 추가`}
        disabled={waiting || favorites.status === 'error'}
        title={favorites.status === 'error' ? favorites.message : undefined}
        onClick={() => void onClick()}
      >
        <HeartIcon filled={on} />
        관심 카드
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
