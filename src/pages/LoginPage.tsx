import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import { safeNext, signInUrl } from '../api/account'
import { useSession } from '../hooks/useSession'
import styles from './AccountPages.module.css'

// The API sends sign-in problems here with a fixed reason; the provider's own text is never shown
const ERRORS: Record<string, string> = {
  cancelled: '로그인을 취소했어요. 다시 시도해 주세요.',
  expired: '로그인 시간이 지났어요. 다시 시도해 주세요.',
  failed: '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.',
}

// Brand marks as each brand's guide draws them (Kakao: black symbol on #FEE500; Google: the "G")
function KakaoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M9 1.5C4.6 1.5 1 4.3 1 7.7c0 2.2 1.5 4.1 3.7 5.2l-.9 3.4c-.1.3.3.6.5.4l4-2.7h.7c4.4 0 8-2.8 8-6.3S13.4 1.5 9 1.5z" fill="#000" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}

/** /login?next=…&error=… (docs/design/auth-login.webp): signing in and signing up are the same step */
export default function LoginPage() {
  const [params] = useSearchParams()
  const session = useSession()
  const next = safeNext(params.get('next'))
  const error = params.get('error')
  const message = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : null

  useEffect(() => {
    document.title = '로그인 · Pokémon Card Dex'
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [])

  return (
    <main className={styles.center}>
      <meta name="robots" content="noindex" />
      <div className={styles.loginBox}>
        <h1 className={styles.loginTitle}>로그인 / 가입</h1>
        {session.status === 'in' ? (
          <p className={styles.notice} role="status">
            {session.user.nickname}님으로 로그인되어 있어요. <Link to={next}>계속하기</Link>
          </p>
        ) : (
          <>
            <p className={styles.lead}>처음이면 바로 계정이 만들어져요. 덱과 관심 카드를 어느 기기에서나 볼 수 있어요.</p>
            {message && (
              <p className={styles.alert} role="alert">
                {message}
              </p>
            )}
            {/* Plain links: a full page load, so the API can set its cookie and send the browser on */}
            <a className={styles.kakao} href={signInUrl('kakao', next)}>
              <KakaoMark />
              카카오 로그인
            </a>
            <a className={styles.google} href={signInUrl('google', next)}>
              <GoogleMark />
              Google 계정으로 로그인
            </a>
            <p className={styles.small}>구글과 카카오는 서로 다른 계정으로 만들어져요. 처음 쓴 방법으로 계속 로그인해 주세요.</p>
            <p className={styles.small}>
              로그인하면 <Link to="/terms">이용약관</Link>과 <Link to="/privacy">개인정보처리방침</Link>에 동의하는 것으로 봐요.
              이메일·프로필은 받지 않아요.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
