import { useRouteError } from 'react-router'
import styles from './ListStates.module.css'
import frame from './RouteError.module.css'

/**
 * A page's code chunk is missing: almost always a tab opened before a deploy (each deploy only
 * serves its own /assets), so the page the user is going to now lives under a new name.
 */
function isStaleChunk(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically/i.test(message)
}

/** Shown in place of a page that failed to load or crashed; the header stays */
export default function RouteError() {
  const error = useRouteError()
  const stale = isStaleChunk(error)
  return (
    <main className={frame.main}>
      <div className={styles.center} role="alert">
        <h1 className={styles.title}>{stale ? '사이트가 새 버전으로 바뀌었어요' : '페이지를 보여 주지 못했어요'}</h1>
        <p className={styles.desc}>
          {stale ? '새로고침하면 최신 버전으로 이어서 볼 수 있어요.' : '잠시 후 다시 시도해 주세요. 계속되면 새로고침해 주세요.'}
        </p>
        <button type="button" className={styles.primary} onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    </main>
  )
}
