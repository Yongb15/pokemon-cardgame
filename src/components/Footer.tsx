import { Link } from 'react-router'
import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p className={styles.inner}>
        카드 데이터:{' '}
        <a href="https://github.com/PokemonTCG/pokemon-tcg-data" target="_blank" rel="noreferrer">
          pokemon-tcg-data
        </a>{' '}
        · 한국어 이름:{' '}
        <a href="https://pokeapi.co" target="_blank" rel="noreferrer">
          PokéAPI
        </a>
        ·포켓몬코리아 공식 카드 검색·자체 번역{' '}
        · 이미지: Pokémon TCG API · Pokémon은 Nintendo / Creatures / GAME FREAK의 상표이며, 이 사이트는 비공식 팬
        프로젝트입니다.
      </p>
      <p className={styles.inner}>
        <Link to="/privacy">개인정보처리방침</Link> · <Link to="/terms">이용약관</Link>
      </p>
    </footer>
  )
}
