import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/pokemonTcg'
import CardGrid from './CardGrid'
import styles from './ListStates.module.css'

export function SkeletonGrid({ count }: { count: number }) {
  return (
    <CardGrid busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeleton} aria-hidden="true">
          <div className={styles.skImage} />
          <div className={styles.skLine} />
          <div className={`${styles.skLine} ${styles.short}`} />
        </div>
      ))}
    </CardGrid>
  )
}

export function SlowNotice() {
  return (
    <p className={styles.slow} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      응답이 늦어지고 있어요. 카드 서버가 느려 조금 더 걸릴 수 있으니 잠시만 기다려 주세요.
    </p>
  )
}

export function EmptyState({ query, onReset }: { query: string; onReset: () => void }) {
  return (
    <div className={styles.center}>
      <div className={styles.icon} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <h2 className={styles.title}>{query ? `“${query}”에 맞는 카드가 없어요` : '조건에 맞는 카드가 없어요'}</h2>
      <p className={styles.desc}>
        철자를 확인하거나 필터를 줄여 보세요.
        <br />
        카드 이름은 영문으로 검색됩니다.
      </p>
      <button type="button" className={styles.ghost} onClick={onReset}>
        필터 초기화
      </button>
    </div>
  )
}

/** The search term can't be sent to the API (Korean, only symbols) or the API rejected it (400). */
export function InvalidSearchState({
  reason,
  query,
  onClear,
}: {
  reason: 'hangul' | 'unsupported' | 'rejected'
  query: string
  onClear: () => void
}) {
  const desc =
    reason === 'hangul' ? (
      <>
        카드 이름은 영문으로만 검색할 수 있어요.
        <br />
        예: 피카츄 → Pikachu, 리자몽 → Charizard
      </>
    ) : (
      <>
        영문, 숫자와 일부 기호(' . - :)만 검색에 쓸 수 있어요.
        <br />
        검색어를 바꿔 다시 입력해 주세요.
      </>
    )
  return (
    <div className={styles.center} role="status">
      <div className={styles.icon} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <h2 className={styles.title}>
        {reason === 'hangul' ? `“${query}”은(는) 영문으로 검색해 주세요` : '검색어를 확인해 주세요'}
      </h2>
      <p className={styles.desc}>{desc}</p>
      <button type="button" className={styles.ghost} onClick={onClear}>
        검색어 지우기
      </button>
    </div>
  )
}

/** A missing card or an unknown address */
export function NotFoundState({ title, description }: { title: string; description: ReactNode }) {
  return (
    <div className={styles.center} role="status">
      <div className={styles.icon} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 16.5v.01" />
        </svg>
      </div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.desc}>{description}</p>
      <Link className={styles.ghost} to="/">
        카드 목록으로
      </Link>
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const detail = error instanceof ApiError ? error.message : '알 수 없는 오류가 발생했습니다.'
  return (
    <div className={styles.center} role="alert">
      <div className={`${styles.icon} ${styles.danger}`} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
      </div>
      <h2 className={styles.title}>카드를 불러오지 못했어요</h2>
      <p className={styles.desc}>
        카드 서버가 잠시 응답하지 않습니다. 잠시 후 다시 시도해 주세요.
        <br />
        <span className={styles.detail}>({detail})</span>
      </p>
      <button type="button" className={styles.primary} onClick={onRetry}>
        다시 시도
      </button>
    </div>
  )
}
