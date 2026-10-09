# M6 로그인·회원가입 + 사용자 데이터 — 설계

- 상태: 초안 (2026-10-08) · 검토: qa, Security
- 결정 배경: [ADR 0003 모노레포·API 서버](../adr/0003-monorepo-and-api-server.md), [ADR 0004 소셜 로그인·세션](../adr/0004-social-login-and-sessions.md)

## 1. 범위

| 이번(M6) | 이후 |
|---|---|
| 구글·카카오 로그인, 로그아웃, 모든 기기 로그아웃, 탈퇴 | 이메일 가입(도메인 후) |
| 내 덱을 계정에 저장(브라우저 덱 가져오기 포함) | 덱 공개·공유 페이지 |
| 관심 카드(하트) | 가격 알림(M8) |
| 마이페이지(닉네임), 개인정보처리방침·이용약관 | 거래자 프로필·평가(M8) |
| 모노레포 전환, NestJS 서버, CI/CD | 경매·포인트(M7) |

## 2. 구성

```
브라우저 ──> pokemon-card-dex-green.vercel.app
              ├─ /api/cards/*, /api/prices   Vercel Functions (그대로)
              └─ /api/v1/*  ──rewrite──> Cloud Run (asia-southeast3) · NestJS
                                              ├─ AuthModule      /auth/{google|kakao}/start, /callback, /logout
                                              ├─ SessionGuard    쿠키 → 세션 조회 → req.user
                                              ├─ MeModule        /me (닉네임, 탈퇴, 모든 기기 로그아웃)
                                              ├─ DecksModule     /decks CRUD, /decks/import
                                              └─ FavoritesModule /favorites
                                              ↓ (app role: api_rw)
                                        Neon PostgreSQL (production / dev)
```

- 모노레포: `apps/web`(지금 앱), `apps/api`(NestJS), `packages/shared`(Drizzle 스키마·zod 검증·타입)
- API 서버는 **별도 DB 계정 `api_rw`**: 사용자 테이블만 권한. 시세 함수의 `app_rw`와 분리(서로의 테이블을 못 건드림)
- 비밀 값: Secret Manager → Cloud Run 환경변수 (`DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, `KAKAO_CLIENT_SECRET`), 저장소·채팅에 없음

## 3. 데이터 모델 (ERD)

```mermaid
erDiagram
  users ||--o{ oauth_accounts : has
  users ||--o{ sessions : has
  users ||--o{ decks : owns
  users ||--o{ favorites : likes
  users {
    uuid id PK
    text nickname "2~20자, 표시용"
    timestamptz created_at
  }
  oauth_accounts {
    text provider PK "google | kakao"
    text subject PK "제공자의 sub"
    uuid user_id FK
    timestamptz created_at
  }
  sessions {
    bytea token_hash PK "SHA-256(쿠키 토큰)"
    uuid user_id FK
    timestamptz created_at
    timestamptz expires_at "30일, 사용 시 연장"
    timestamptz last_seen_at
  }
  decks {
    uuid id PK
    uuid user_id FK
    text name "1~50자 (cleanDeckName과 같은 규칙)"
    text format "standard | expanded | unlimited"
    jsonb cards "[{id, count}] 최대 60장, 카드 id 검증"
    int version "낙관적 잠금"
    timestamptz updated_at
  }
  favorites {
    uuid user_id PK
    text card_id PK
    timestamptz created_at
  }
```

- 모든 외래 키는 `ON DELETE CASCADE` → 탈퇴 한 번에 전부 삭제
- 한도: 사용자당 덱 100개(지금 브라우저 한도와 같음), 관심 카드 500장 — DB 제약 + 서버 검증
- 덱 저장은 `version`으로 낙관적 잠금: 두 기기에서 동시에 고치면 나중 저장이 409("다른 곳에서 바뀌었어요")

## 4. 로그인 흐름 (구글 예시, 카카오 동일)

1. `GET /api/v1/auth/google/start?next=/decks` — `state`, `nonce`, PKCE `code_verifier` 생성 → 10분짜리 쿠키 `__Host-oauth`(서명·암호화)에 저장 → 구글로 302
2. 구글 → `GET /api/v1/auth/google/callback?code&state`
   - 쿠키의 state와 대조, code + code_verifier로 토큰 교환
   - id_token 검증: JWKS 서명, `iss`, `aud`(우리 client id), `exp`, `nonce`
   - `(google, sub)`로 계정 조회, 없으면 사용자 생성(닉네임은 기본값 "트레이너1234", 나중에 변경)
   - 새 세션 생성 → `__Host-session` 쿠키 → `next`(우리 사이트 내부 경로만 허용)로 302
3. 이후 요청: `SessionGuard`가 쿠키 해시로 세션 조회(만료 확인, 슬라이딩 연장은 하루 1번만 기록)

## 5. 브라우저 덱 → 계정 덱

- 로그인 후 덱 페이지에서 "이 브라우저의 덱 N개를 계정에 저장할까요?" 한 번 묻기
- `POST /api/v1/decks/import` — 기존 `sanitizeDeck` 규칙(shared로 이동)으로 검증, 이름이 같으면 "(가져옴)" 붙임, 한도 초과분은 결과로 알림
- 로그인 상태에서는 계정 덱을 보여주고 브라우저 저장은 쓰지 않음(로그아웃 상태는 지금처럼 브라우저 저장)

## 6. 보안 체크리스트 (Security 점검 항목)

- [ ] OAuth: state·nonce·PKCE, id_token 검증(JWKS·iss·aud·exp·nonce), 콜백 `next`는 내부 경로만(오픈 리다이렉트 방지)
- [ ] 세션: `__Host-` 쿠키, 해시 저장, 로그인 시 새 토큰, 만료·로그아웃 즉시 무효, 탈퇴 시 전부 삭제
- [ ] CSRF: SameSite=Lax + 상태 변경은 Origin·Content-Type 확인
- [ ] 권한: 모든 사용자 데이터 쿼리에 `user_id = 세션 사용자` 조건(다른 사람 덱 id로 접근 시 404)
- [ ] 입력: zod 스키마(shared) — 덱 이름·카드 id·수량·개수 한도, 알 수 없는 필드 거부
- [ ] 요청 제한: 로그인 시작·콜백·쓰기 API에 IP·사용자별 제한
- [ ] DB: `api_rw` 최소 권한, 바인딩만, 오류는 일반 메시지
- [ ] 배포: Workload Identity(키 파일 없음), Secret Manager, Cloud Run은 Vercel 프록시 경유만 받도록(헤더 비밀 값 확인)
- [ ] 개인정보: 최소 수집, 처리방침 페이지, 탈퇴 즉시 파기, 로그에 토큰·쿠키 남기지 않음

## 7. 테스트

- 단위(Vitest/Jest): 세션 토큰 해시·만료·연장, next 경로 검증, 덱 검증(shared)
- 통합: NestJS e2e + **Neon 임시 브랜치**(CI 실행마다 dev에서 분기 → 끝나면 삭제) — 실제 PostgreSQL로 권한·제약까지 확인
- OAuth는 제공자 응답을 흉내 낸 가짜 서버(JWKS 포함)로 테스트 — 서명 위조·nonce 불일치·만료 토큰 거부 확인
- qa: 실제 구글·카카오 계정으로 미리보기에서 로그인 흐름, 덱 가져오기, 탈퇴

## qa 설계 검토 반영 (2026-10-08)

**먼저 정한 것**
- **L-1 로그인 테스트**: 실제 구글·카카오는 자동화 브라우저에서 막히고 qa가 실제 계정을 다루면 안 된다 →
  (a) **미리보기 전용 테스트 로그인** `/api/v1/auth/test/start` — 가짜 OIDC 제공자(서명된 id_token, JWKS)로 실제와 같은 콜백·세션 코드를 탄다. `VERCEL_ENV=preview`(API 서버는 `APP_ENV=preview`)이고 `AUTH_TEST_PROVIDER=1`일 때만 켜지며 production 빌드에서는 라우트 자체를 등록하지 않음(Security 검토)
  (b) 실제 구글·카카오 로그인은 **사용자가 qa 체크리스트로 직접 한 번**(동의·취소·성공·로그아웃·탈퇴), develop 미리보기와 정식 주소에서
- **L-2 리디렉트 주소**: 제공자는 와일드카드를 받지 않는다 → 정식 주소와 **develop 고정 미리보기**(`pokemon-card-dex-git-develop-dydqls-projects.vercel.app`)만 등록. feature 미리보기는 테스트 로그인만
- **L-3 카카오**: 앱 검수 전에는 팀원만 로그인 가능 → 사용자 계정을 팀원으로 등록
- **R-1 모노레포 경로**: 웹 앱을 옮기지 않는다. **저장소 루트 = 웹(그대로)**, 여기에 `apps/api`, `packages/shared`만 workspace로 추가 → `data/`, `server/prices/fixtures`, `vercel.json`의 경로가 바뀌지 않음. (`apps/web`으로 옮기는 정리는 위험 대비 이득이 작아 하지 않음)
- **I-1 가져온 브라우저 덱**: 가져오기에 **성공한 덱은 브라우저에서 지운다**(실패한 덱만 남김) — 로그아웃 후 옛 버전이 보이는 혼란 방지
- **I-2 중복 가져오기**: 브라우저 덱 id를 `source_id`로 보내고 `UNIQUE(user_id, source_id)` → 재시도·다른 브라우저에서 다시 가져와도 "이미 가져온 덱 N개"

**가져오기 세부**
- 묻기 선택지: 저장 / 나중에(sessionStorage) / 묻지 않기(localStorage), 덱 페이지에 "이 브라우저의 덱 가져오기" 버튼 상시
- 이름 충돌: "(가져옴)", 또 겹치면 "(가져옴 2)"…, 접미사만큼 이름을 먼저 잘라 50자 유지
- 한도 초과: 최근 수정 순으로 넣고 나머지는 브라우저에 남김("N개는 한도(100) 때문에 이 브라우저에 남겨 뒀어요"), 검증 실패 덱은 따로 개수 표시
- 로그인 상태에서 API 실패: 브라우저 덱으로 대신 보여주지 않음 → 오류 + 다시 시도(카드·시세 화면은 영향 없음)
- 공유 링크 "내 덱으로 저장": 로그인 시 계정, 로그아웃 시 브라우저
- 편집 중 로그인: 떠나기 전 브라우저 초안 저장, `next`로 같은 덱에 복귀

**충돌(409)**: 내 수정은 메모리에 유지, `role=alert` "다른 기기에서 이 덱이 바뀌었어요" [최신 버전 불러오기] [내 변경을 사본으로 저장]. 덮어쓰기는 처음엔 없음, 자동 저장은 409에서 멈춤

**상태 정의**
- 세션 만료/다른 기기에서 로그아웃: 401 → "로그인이 만료됐어요" + 현재 경로로 돌아오는 로그인 버튼(수정 유지), 헤더는 오류가 아닌 "로그인 필요"
- API 서버 첫 요청(1~2초): 덱·마이페이지 스켈레톤, 처리 중 버튼 비활성(중복 제출 방지)
- API 서버 장애/5xx/429: `role=alert` + 다시 시도(429는 "잠시 후"), 로그인 상태가 "모름"이면 헤더에 "로그아웃"으로 단정하지 않음
- 콜백 오류(동의 취소, state 없음·만료, code 재사용): 우리 페이지에서 친절한 문구 + 다시 로그인(제공자 원문 노출 안 함)
- 탈퇴: 덱·관심 카드 개수를 보여주는 확인 대화상자, 탈퇴 후 브라우저 덱은 그대로(계정과 무관), 이동 후 본문 제목에 포커스
- 닉네임: 2~20자, 앞뒤 공백 제거, 제어·방향·폭 없는 문자 제거(덱 이름 규칙 재사용), 중복 허용, 320px 헤더 넘침 확인
- 관심 카드: 로그아웃 시 로그인 유도 후 실행, 낙관적 토글+실패 시 되돌림·안내, `aria-pressed`·"관심 카드에 추가/빼기", 500장 한도 안내
- 로그인 페이지에 "구글과 카카오는 서로 다른 계정으로 만들어져요", 버튼은 각 사의 브랜드 가이드(카카오 #FEE500/검정 글자)

**모노레포 전환 회귀 검사(1단계)**: 이전 production 빌드 기준 고정 URL 20개 응답 비교(본문·상태 코드·캐시 헤더), 화면 경로 직접 진입·새로고침, v1.2.x localStorage 덱 그대로, 헤더·CSP·번들(서버 코드·비밀 없음, 크기 ±5%), Lighthouse, Vitest 전체, dev 미리보기 cron 수동 1회

## Security 설계 검토 반영 (2026-10-08)

**프록시 ↔ Cloud Run 신뢰 경계**
- `vercel.json` rewrite는 외부 목적지에 요청 헤더를 붙이지 못한다(미리보기에서 확인 예정) → **Vercel Routing Middleware**(`middleware.ts`, `/api/v1/:path*`)에서 rewrite하며 `X-Proxy-Auth`(Sensitive 환경변수)를 덮어써 붙인다. 안 되면 catch-all 함수 프록시. 장기적으로는 Cloud Run 비공개 + Vercel OIDC → GCP ID 토큰
- (필수) NestJS가 `timingSafeEqual`로 확인, 값이 없거나 32자 미만이면 `/health` 외 전부 거부(fail closed). `/health`는 일치 여부(boolean)만
- (필수) 클라이언트 IP는 헤더 확인을 통과한 요청에서만 Vercel의 `x-real-ip`/`x-vercel-forwarded-for`로(직접 호출이 `X-Forwarded-For`로 요청 제한을 우회하지 못하게)
- (필수) `redirect_uri` 등 절대 URL은 환경변수의 고정값으로만(Host 헤더로 만들지 않음)
- (필수) `/api/v1` 응답은 전부 `Cache-Control: no-store`(Set-Cookie가 엣지에 캐시되면 남의 세션이 나감), 보안 헤더 6종도 적용
- M7 주의: Vercel rewrite는 WebSocket을 프록시하지 않는다 → 실시간 입찰은 M7 설계에서(일회용 티켓 + Origin 확인, 또는 SSE)

**OAuth**
- (필수) id_token: 알고리즘 `RS256` 고정, `iss` 정확히 일치(구글 2가지 표기, 카카오 `https://kauth.kakao.com`), `aud`(+구글 `azp`), 시계 오차 60초, JWKS는 고정된 discovery 주소에서 `createRemoteJWKSet`로 캐시
- (필수) `__Host-oauth`는 일회용: 성공·실패 모두 콜백에서 삭제, 제공자 이름 포함(다른 제공자 콜백이면 거부), state는 상수 시간 비교, `next`도 쿠키 안에
- (필수) `next`: 200자 이하, `/`로 시작, `//`·`/\`·제어 문자 거부, `new URL(next, ORIGIN).origin === ORIGIN` 확인 후 경로+쿼리만, 실패 시 `/`
- 제공자 오류(`access_denied` 등)는 고정 문구로(`error_description`을 그대로 보여주지 않음)
- scope는 `openid`만(이메일·프로필 동의 없음), `response_mode=query`(form_post는 Lax 쿠키가 안 감), 계정 생성은 `(provider, subject)` 유일 + `ON CONFLICT`
- 카카오: OIDC 켜기, client_secret 사용, 탈퇴 시 연결 끊기 API 호출(선택: 카카오 연결 해제 콜백 받아 계정 삭제)

**세션·CSRF·비용 보호**
- (필수) 절대 만료: 30일 슬라이딩이지만 생성 후 90일이면 다시 로그인. 연장 시 쿠키 Max-Age도 갱신
- 사용자당 세션 20개(넘으면 오래된 것 삭제), 만료 세션 주기적 삭제
- (필수) 로그아웃은 POST만 + Origin 확인
- (필수) 상태 변경 요청: Origin 없으면 거부, 허용 목록은 환경변수의 정확한 값(정식 1개, 미리보기는 이 프로젝트 주소만, `*.vercel.app` 전체 허용 금지), CORS는 켜지 않음
- (필수) Cloud Run 최대 인스턴스 2~3·동시성·요청 시간 10초, **GCP 결제 예산 알림($1/$5)**, 본문 64KB 제한, DB 한도(덱 100·관심 500·세션 20)

**개인정보(개인정보보호법 최소 요건 — 법률 자문 아님, 사용자 확인 필요)**
- 처리방침: 수집 항목(제공자·sub·닉네임·세션 정보·접속 로그), 목적·보유 기간·파기, **처리 위탁·국외 이전**(Google Cloud 싱가포르, Neon 싱가포르, Vercel 미국/글로벌: 국가·항목·시기·방법·기간), 쿠키, 이용자 권리, 문의처(이메일)
- 만 14세 미만 가입 불가: 약관 + 가입 시 확인
- 탈퇴: 즉시 CASCADE 삭제 + 세션 삭제, 백업(Neon 복구 기간)·로그는 "N일 이내 파기" 명시
- (필수) 토큰·쿠키·Authorization·콜백의 code/state를 로그에 남기지 않음(콜백 직후 302로 URL 정리, 로그 보관 30일 이하)

**배포·기타**
- (필수) WIF 조건: `assertion.repository == 'Yongb15/pokemon-cardgame' && assertion.ref == 'refs/heads/main'`
- 실행용·배포용 서비스 계정 분리, 실행 계정은 필요한 비밀 값에만 `secretAccessor`
- Secret Manager: OAuth 쿠키 암호화 키, 프록시 헤더 비밀 값, client_secret(교체 절차 문서화)
- 운영: 예외는 일반 메시지(스택 없음), `x-powered-by` 끔, Swagger 미등록
- DB: **스키마 분리**(`auth`/`app` 등)로 `api_rw`는 시세 테이블, `app_rw`는 사용자 테이블에 접근 불가
- 닉네임은 덱 이름 규칙(제어·방향 문자 제거, 길이) 재사용, 텍스트로만 렌더링
- 추가 테스트: 남의 덱 id로 수정·삭제 → 404, 로그인 쿠키 재사용, `next` 퍼징(`//evil.com`, `/\evil.com`, `https:`, 제어 문자), Origin 없음·다름 → 403, 헤더 없는 Cloud Run 직접 호출 → 401

## 8. 작업 순서

1. 모노레포 전환(웹은 루트 그대로, apps/api·packages/shared 추가, 동작 변화 없음) — qa 회귀 확인
2. NestJS 뼈대 + `/api/v1/health` + Cloud Run 배포 파이프라인 + Vercel 프록시
3. 사용자·세션 스키마, `api_rw` 계정, 구글 로그인
4. 카카오 로그인
5. 서버 덱·관심 카드·브라우저 덱 가져오기
6. 화면: 로그인 버튼·마이페이지·하트·개인정보처리방침·이용약관
7. qa·Security 검토 → v1.3.0

## 9. 사용자 준비물 (해당 단계에서 안내)

- 2단계: Google Cloud 계정·결제 카드 등록·프로젝트 생성 (나머지 설정은 CLI로)
- 3단계: Google OAuth 클라이언트 등록(동의 화면 포함)
- 4단계: 카카오 디벨로퍼스 앱 등록(OpenID Connect 켜기)

## 테스트 로그인(qa L-1) 조건 — Security (2026-10-08)
1. 이중 차단: `APP_ENV=preview && AUTH_TEST_PROVIDER=1`일 때만 라우트 등록 + 연결된 DB가 dev 브랜치가 아니면(`dev_marker` 없음) 시작 시 실패. production 서비스에 `AUTH_TEST_PROVIDER`가 있으면 시작 거부
2. 네임스페이스 분리: `provider='test'`만 만들고 찾는다. `google`·`kakao`의 sub로는 절대 조회·생성 불가(실제 계정 사칭 방지)
3. 별도 키·발급자: 가짜 제공자의 JWKS·iss는 실제 제공자 신뢰 목록에 없음. 검증은 제공자별 정확한 iss/aud
4. 공개 전제: 미리보기는 누구나 접근 가능 → 테스트 계정은 dev DB·테스트 데이터만, 어떤 추가 권한도 없음
5. 테스트: production 빌드(`APP_ENV=production`)에서 `/auth/test/*` → 404

## 5단계 API (2026-10-09)

로그인한 사용자의 데이터. 모든 경로에 세션이 필요하고(없으면 401), 쓰기는 사용자별 분당 60회(넘으면 429 + `Retry-After: 60`), 상태 변경은 Origin 확인(없거나 다른 사이트면 403). 다른 사람 덱 id·형식이 틀린 id는 모두 404.

| 메서드 | 경로 | 결과 |
|---|---|---|
| GET | `/api/v1/decks` | `{ decks }` 최근 수정 순 |
| POST | `/api/v1/decks` | 201 `{ deck }` · 100개 한도 422 |
| GET | `/api/v1/decks/:id` | `{ deck }` |
| PUT | `/api/v1/decks/:id` | `{ deck }` (`version` 필수) · 다른 기기가 먼저 저장했으면 409 |
| DELETE | `/api/v1/decks/:id` | 204 |
| POST | `/api/v1/decks/import` | 200 `{ imported: [{sourceId, id}], duplicates, overLimit, invalid }` |
| GET | `/api/v1/favorites` | `{ cards }` 최근 추가 순 |
| PUT / DELETE | `/api/v1/favorites/:cardId` | 204 (이미 있는 카드 추가도 204) · 500장 한도 422 |
| GET | `/api/v1/me/summary` | `{ decks, favorites }` (탈퇴 확인 대화상자용) |
| PATCH | `/api/v1/me` `{ nickname }` | `{ user }` · 2~20자 아니면 400 |
| POST | `/api/v1/me/logout-all` | 204, 모든 기기의 세션 삭제 |
| DELETE | `/api/v1/me` | 204, 계정과 로그인 수단·세션·덱·관심 카드 전부 삭제(CASCADE) |

- **덱 모양**: `{ id, name, format, cards: [{id, count}], version, updatedAt }`. 사용자 id는 내보내지 않음
- **검증**(packages/shared): 이름은 `cleanDeckName` 후 1~50자, 형식 3종, 카드는 엄격 검사 `validCards`(최대 60종, id 형식, 수량 1~60, 중복 id·알 수 없는 필드 거부). 요청 본문은 zod `strictObject`라 모르는 필드가 있으면 400. 카드가 실제로 있는지는 API 서버가 카드 데이터를 갖고 있지 않아 형식만 본다(웹은 모르는 카드를 "찾을 수 없는 카드"로 보여 줌)
- **가져오기**: 항목은 브라우저 저장소를 읽을 때처럼 고쳐서 받는다(`sanitizeCards`, 이름 없으면 "가져온 덱", 형식이 이상하면 스탠다드). `sourceId`가 없거나 형식이 틀리면 `invalid`. 같은 `sourceId`가 두 번 오면 마지막 것. 최근 수정 순으로 남은 자리만큼 넣고 나머지는 `overLimit`(브라우저에 남김). 본문 한도는 이 경로만 256KB
- **한도 경쟁**: 덱 100개·관심 카드 500장은 사용자별 트랜잭션 advisory lock 안에서 세고 넣는다(동시 요청 두 개가 둘 다 99를 보고 101이 되는 일 방지)
- **권한**(마이그레이션 0008): `decks` SELECT·DELETE, INSERT(user_id, source_id, name, format, cards), UPDATE(name, format, cards, version, updated_at) / `favorites` SELECT·DELETE, INSERT(user_id, card_id). id·version 기본값·created_at은 API가 정할 수 없음. 시작 시 이 목록을 확인(없으면 시작 거부)
- **카카오 연결 끊기**: 탈퇴할 때 카카오 쪽 연결 해제(unlink)는 하지 않는다. 카카오 액세스 토큰을 저장하지 않고(로그인 때 sub만 씀), 대신 쓸 수 있는 Admin 키는 사용자 관리 전체 권한이라 쓰지 않기로 함(Security K-2). 우리 쪽 데이터는 즉시 전부 지워지고, 카카오 "연결된 서비스" 목록에는 남는다 → 처리방침에 안내(6단계)
