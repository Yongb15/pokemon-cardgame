# ADR 0003 — 모노레포와 API 서버 (NestJS on Cloud Run)

- 상태: 채택 (2026-10-08)
- 관련: M6 로그인·DB, M7 경매

## 배경

로그인부터는 사용자별 데이터(세션·덱·관심 카드, 이후 포인트·입찰)를 다룬다. 지금까지는 Vercel Functions(파일 하나당 함수)로 충분했지만,

- 인증·세션·권한 같은 공통 처리(미들웨어, 가드, 검증)를 한 서버 구조로 묶는 편이 안전하고,
- M7 경매의 실시간 입찰(WebSocket)은 오래 열려 있는 연결이 필요하며,
- 풀스택 포트폴리오로 "백엔드 서버를 직접 설계·배포"한 경험을 보여주는 것이 목표다.

## 결정

1. **npm workspaces 모노레포**
   ```
   apps/web        지금의 React 앱 + Vercel Functions(카드·시세, 그대로)
   apps/api        NestJS API 서버 (로그인·세션·사용자 데이터, 이후 경매)
   packages/shared DB 스키마(Drizzle)·입력 검증(zod)·API 타입 — 웹과 API가 같은 정의를 씀
   ```
2. **API 서버는 Google Cloud Run** (사용자 결정)
   - 리전 **asia-southeast1(싱가포르)**: DB(Neon 싱가포르) 옆이라 쿼리 왕복이 짧다(서울 리전이면 쿼리마다 ~70ms)
   - 최소 인스턴스 0(무료 사용량 안에서 0원), 첫 요청은 1~2초 느릴 수 있음
   - WebSocket 지원(M7)
3. **같은 출처(Same origin)로 묶는다**: Vercel이 `/api/v1/*`을 Cloud Run으로 프록시(rewrite)한다
   - 세션 쿠키를 `pokemon-card-dex-green.vercel.app`에 그대로 둘 수 있어 CORS·서드파티 쿠키 문제가 없다
   - CSP `connect-src 'self'` 유지
4. **카드·시세 API는 Vercel Functions 그대로**(데이터가 빌드 파일이라 엣지 캐시가 유리). 사용자 데이터만 API 서버로.
5. **배포는 GitHub Actions + Workload Identity Federation** — 서비스 계정 키 파일 없이 GitHub이 짧은 토큰으로 배포. 비밀 값은 Secret Manager → Cloud Run 환경변수.

## 대안

| 대안 | 제외 이유 |
|---|---|
| Vercel Functions 유지 | 서버 구조·실시간 연결 경험이 약하고, M7에 외부 실시간 서비스가 따로 필요 |
| Railway / Fly.io | 무료 한도 없음(월 $5~) |
| Render 무료 | 15분 미사용 시 잠들고 깨어나는 데 수십 초 |
| 별도 도메인의 API(교차 출처) | 서드파티 쿠키 제한, CORS·CSRF 처리가 복잡 |

## 결과

- 사용자 준비물: Google Cloud 계정(결제 카드 등록), 프로젝트 생성, 소셜 로그인 앱 등록(구글·카카오)
- 프록시 한 단계(Vercel → Cloud Run)만큼 지연이 생기지만 캐시하지 않는 사용자 요청만 해당
