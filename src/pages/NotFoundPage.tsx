import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { NotFoundState } from '../components/ListStates'
import styles from './CardDetailPage.module.css'

export default function NotFoundPage() {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = '페이지를 찾을 수 없어요 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  return (
    <main className={styles.main}>
      {/* The SPA answers every path with 200; keep unknown pages out of search results (React hoists this to <head>) */}
      <meta name="robots" content="noindex" />
      <div className={styles.message}>
        <NotFoundState
          title="페이지를 찾을 수 없어요"
          description={
            <>
              주소를 다시 확인해 주세요.
              <br />({pathname})
            </>
          }
        />
      </div>
    </main>
  )
}
