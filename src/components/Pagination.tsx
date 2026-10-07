import { pageItems } from '../lib/pagination'
import styles from './Pagination.module.css'

interface Props {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export default function Pagination({ page, totalPages, onChange }: Props) {
  if (totalPages <= 1) return null

  return (
    <nav className={styles.pager} aria-label="페이지">
      <button
        type="button"
        className={styles.page}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="이전 페이지"
      >
        ‹
      </button>
      {pageItems(page, totalPages).map((item, i) =>
        item === 'gap' ? (
          <span key={`gap-${i}`} className={styles.gap} aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={styles.page}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onChange(item)}
            aria-label={`${item} 페이지`}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className={styles.page}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="다음 페이지"
      >
        ›
      </button>
    </nav>
  )
}
