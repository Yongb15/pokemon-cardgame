import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.inner}>
        카드 데이터·이미지 출처:{' '}
        <a href="https://pokemontcg.io" target="_blank" rel="noreferrer">
          Pokémon TCG API
        </a>{' '}
        · Pokémon은 Nintendo / Creatures / GAME FREAK의 상표이며, 이 사이트는 비공식 팬 프로젝트입니다. 시세는 참고용입니다.
      </p>
    </footer>
  )
}
