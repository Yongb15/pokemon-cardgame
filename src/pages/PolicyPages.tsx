import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import styles from './AccountPages.module.css'

const EFFECTIVE = '2026년 10월 9일'

function Policy({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Pokémon Card Dex`
    return () => {
      document.title = 'Pokémon Card Dex'
    }
  }, [title])
  return (
    <main className={`${styles.main} ${styles.policy}`}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.small}>시행일: {EFFECTIVE}</p>
      {children}
    </main>
  )
}

/** /privacy: what the account feature keeps, why, where, and for how long (docs/auth/design.md) */
export function PrivacyPage() {
  return (
    <Policy title="개인정보처리방침">
      <p>
        Pokémon Card Dex(이하 "사이트")는 개인이 만든 비공식 팬 프로젝트입니다. 카드 검색과 브라우저에 저장하는 덱은
        로그인 없이 쓸 수 있고, 로그인은 덱과 관심 카드를 여러 기기에서 쓰고 싶을 때만 필요합니다.
      </p>

      <h2>1. 받는 정보</h2>
      <ul>
        <li>
          <b>로그인 식별자</b>: 구글 또는 카카오가 주는 사용자 고유번호(sub) 하나. 이메일·이름·프로필 사진·전화번호는
          요청하지도 저장하지도 않습니다.
        </li>
        <li>
          <b>닉네임</b>: 처음 로그인할 때 "트레이너0000" 형식으로 만들어지고, 마이페이지에서 바꿀 수 있습니다.
        </li>
        <li>
          <b>이용 기록</b>: 계정에 저장한 덱, 관심 카드, 로그인 세션(쿠키 값의 해시와 만료 시각).
        </li>
        <li>
          <b>접속 기록</b>: 서버가 자동으로 남기는 요청 기록(IP 주소, 시각, 요청 주소). 계정 서버(Cloud Run) 기록에서는
          로그인 콜백 주소를 뺍니다. 사이트 호스팅(Vercel)의 짧은 기간 요청 기록에는 남을 수 있지만, 그 안의 코드는 한 번만
          쓸 수 있고 이미 사용된 값입니다.
        </li>
      </ul>

      <h2>2. 쓰는 목적</h2>
      <ul>
        <li>로그인 상태 유지와 본인 확인</li>
        <li>계정에 저장한 덱·관심 카드를 보여 주고 저장하기</li>
        <li>과도한 요청을 막는 등 서비스의 안전한 운영</li>
      </ul>
      <p>광고, 마케팅, 다른 회사에 판매하는 데에는 쓰지 않습니다.</p>

      <h2>3. 보관 기간</h2>
      <ul>
        <li>계정 정보와 덱·관심 카드: 탈퇴할 때까지. 탈퇴하면 바로 모두 지웁니다.</li>
        <li>
          로그인 세션: 마지막 사용 후 30일, 길어도 로그인한 날부터 90일이 지나면 쓸 수 없고, 만료된 세션은 주기적으로
          지웁니다. 로그아웃하면 바로 지웁니다.
        </li>
        <li>접속 기록: 30일</li>
      </ul>
      <p>
        <b>파기 방법</b>: 데이터베이스의 정보는 탈퇴·로그아웃·만료 때 복구할 수 없게 삭제합니다. 접속 기록은 보관 기간이
        지나면 각 서비스에서 자동으로 삭제됩니다.
      </p>

      <h2>4. 쿠키와 브라우저 저장소</h2>
      <ul>
        <li>
          <code>__Host-session</code>: 로그인 상태 유지(최대 30일). <code>__Host-oauth</code>: 로그인하는 동안의
          보안 확인(10분, 한 번 쓰면 삭제). 둘 다 이 사이트에서만 읽을 수 있고 광고·추적에 쓰지 않습니다.
        </li>
        <li>로그인하지 않고 만든 덱은 이 브라우저의 저장소(localStorage)에만 있고 서버로 보내지 않습니다.</li>
      </ul>

      <h2>5. 처리를 맡기는 곳(국외 포함)</h2>
      <ul>
        <li>Google Cloud(Cloud Run, 태국 방콕 리전): 로그인·계정 서버 운영</li>
        <li>Neon(AWS 싱가포르 리전): 데이터베이스</li>
        <li>Vercel(미국 등): 사이트 호스팅과 요청 전달</li>
        <li>Google, Kakao: 로그인 수단 제공(각 회사의 개인정보처리방침이 적용됩니다)</li>
      </ul>
      <p>
        <b>국외 이전</b>: 위 정보는 사이트를 이용할 때(로그인, 덱·관심 카드 저장) 네트워크로 태국(Google Cloud),
        싱가포르(Neon), 미국 등(Vercel)의 서버에 전송·저장되며, 3번의 보관 기간 동안 보관됩니다. 각 회사의 개인정보 문의는
        Google Cloud(cloud.google.com/terms/data-processing-addendum), Neon(neon.tech/privacy-policy),
        Vercel(vercel.com/legal/privacy-policy)에서 확인할 수 있습니다. 이전을 원하지 않으면 로그인하지 않고 브라우저 저장
        기능만 쓰거나 탈퇴할 수 있습니다.
      </p>

      <h2>6. 이용자의 권리</h2>
      <ul>
        <li>
          <Link to="/me">마이페이지</Link>에서 닉네임 변경, 모든 기기에서 로그아웃, 탈퇴(모든 정보 즉시 삭제)를 할 수
          있습니다.
        </li>
        <li>
          탈퇴해도 구글·카카오 계정의 "연결된 서비스" 목록에는 이 사이트가 남을 수 있습니다. 각 계정 설정에서 직접 연결을
          끊을 수 있습니다(카카오: 카카오계정 → 연결된 서비스 관리, 구글: Google 계정 → 보안 → 서드 파티 연결).
        </li>
      </ul>

      <h2>7. 개인정보 보호책임자와 문의</h2>
      <p>개인정보 보호책임자: 사이트 운영자(GitHub @Yongb15). 개인 프로젝트라 운영자가 직접 처리합니다.</p>
      <p>
        개인정보 관련 문의는{' '}
        <a href="https://github.com/Yongb15/pokemon-cardgame/issues" target="_blank" rel="noreferrer">
          GitHub 이슈
        </a>
        로 남겨 주세요. 공개되는 곳이니 개인정보는 적지 말아 주세요.
      </p>
    </Policy>
  )
}

/** /terms */
export function TermsPage() {
  return (
    <Policy title="이용약관">
      <h2>1. 서비스</h2>
      <p>
        Pokémon Card Dex는 포켓몬 카드 정보를 찾아보고 덱을 만들어 볼 수 있는 무료 비공식 팬 프로젝트입니다. Pokémon과
        관련 이름·이미지는 Nintendo / Creatures / GAME FREAK의 상표이며, 이 사이트는 이들과 관계가 없습니다.
      </p>

      <h2>2. 정보의 정확성</h2>
      <p>
        카드 정보, 한글 이름(일부는 직접 번역), 시세와 환율은 공개된 자료를 모은 참고용입니다. 정확하거나 최신이라고
        보장하지 않으며, 거래나 대회 참가 같은 결정은 공식 자료로 확인해 주세요.
      </p>

      <h2>3. 계정</h2>
      <ul>
        <li>구글 또는 카카오 계정으로 로그인하면 계정이 만들어집니다. 두 수단은 서로 다른 계정입니다.</li>
        <li>다른 사람을 사칭하거나 불쾌감을 주는 닉네임은 쓸 수 없습니다.</li>
        <li>자동화된 과도한 요청, 보안 장치를 우회하려는 시도, 다른 사람의 계정 사용은 금지되며 이용이 제한될 수 있습니다.</li>
        <li>언제든 마이페이지에서 탈퇴할 수 있고, 탈퇴하면 계정의 데이터가 모두 바로 지워집니다.</li>
      </ul>

      <h2>4. 서비스 변경과 중단</h2>
      <p>
        개인이 운영하는 프로젝트라 기능이 바뀌거나 서비스가 중단될 수 있습니다. 중단할 때는 가능한 한 미리 사이트에
        알리겠습니다. 중요한 덱은 덱 화면의 "내보내기"로 따로 보관해 두세요.
      </p>

      <h2>5. 책임의 한계</h2>
      <p>무료로 제공되는 서비스로, 법이 허용하는 범위에서 서비스 이용으로 생긴 손해에 대해 책임지지 않습니다.</p>

      <p className={styles.small}>
        개인정보는 <Link to="/privacy">개인정보처리방침</Link>을 따릅니다.
      </p>
    </Policy>
  )
}
