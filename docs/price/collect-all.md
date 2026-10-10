# 전체 카드 시세 매일 수집 (M5.2 설계, 2026-10-09)

## 왜
- 지금은 Vercel Cron(무료: **하루 1회, 최대 5분**)으로 하루 최대 2,000장, 스탠다드 위주. 나머지 1만 7천여 장은 누군가 상세를 열어야 시세가 생김
- 그래서 시세 탭 순위가 "모은 카드 기준"이고, 처음 여는 카드는 시세가 비어 있다가 다음 날에야 채워짐
- 시세 출처와 연결된 카드: **20,212장**(기본 에너지 제외), 스탠다드 3,074장

## 어떻게
- **GitHub Actions 예약 실행**(공개 저장소라 무료, 작업당 최대 6시간)
  - `.github/workflows/collect-prices.yml`: `schedule` 매일 19:30 UTC(04:30 KST, Vercel Cron 03:00 다음) + 수동 실행(`workflow_dispatch`). PR·push로는 돌지 않음
  - `permissions: contents: read`만, `actions/checkout`은 `persist-credentials: false`, 사용하는 액션은 커밋 SHA로 고정
  - `concurrency`로 동시에 하나만, `timeout-minutes: 120`
  - 비밀 값은 GitHub **Environment `prices-production`**에만 둠: `PRICE_DATABASE_URL`(운영 `collector_rw`, 수집 전용 계정). Environment는 `main` 브랜치에서만 쓸 수 있게 제한 → 다른 브랜치·포크 PR의 워크플로는 비밀에 접근 불가
- **스크립트** `scripts/collect-prices.ts`(기존 `server/prices/` 코드 재사용)
  1. 오늘 환율 한 번 저장(`fetchFx` → `saveFx`)
  2. 대상: 연결된 모든 카드 중 마지막 갱신이 20시간 넘은 것, 한 번도 안 된 카드 → 오래된 순
  3. `runQueue`(동시 3개) + 카드마다 `claimRefresh`로 원자적 선점(Vercel Cron·상세 조회 갱신과 겹쳐도 한 번만) → `refreshCard`
  4. 출처 배려: 요청 사이 짧은 간격(약 150ms), 실패가 연속으로 많으면(예: 50건) 중단
  5. 100분 마감, 남은 카드는 다음 날 맨 앞
  6. 로그에는 개수만(처리·변경·없음·실패·남음), 오류 내용·주소·비밀은 출력하지 않음
- 예상 시간: 2,000장에 약 4분(현재 Cron 실측) → 2만 장에 약 40~50분
- Vercel Cron은 그대로 둠(스탠다드 먼저, 예비). 두 실행이 겹쳐도 선점 덕분에 같은 카드를 두 번 받지 않음

## 비용·한도
- GitHub Actions: 공개 저장소 무료
- Neon(무료): 하루 약 1시간 더 깨어 있음 → 월 약 30시간(무료 한도 안). 저장은 바뀐 값만 새 행이라 증가 속도 작음
- TCGdex: 무료 공개 API, 공식 요청 제한 문서는 없음 → 동시 3개·간격·연속 실패 시 중단으로 보수적으로

## 보안 검토 포인트
- 운영 DB 접속 주소를 GitHub에 맡김: 수집 전용 최소 권한 `collector_rw`(아래 D-1, account 스키마 접근 불가), Environment + main 브랜치 제한, 로그 출력 금지
- 워크플로 주입: 외부 입력(이슈·PR 제목 등)을 쓰지 않음, `pull_request_target` 없음
- 공급망: 액션 SHA 고정, `npm ci --ignore-scripts`

## 다음
- 수집이 쌓이면 시세 탭 문구를 "전체 카드 기준"으로, 2주 뒤 7일 상승·하락 순위

## Security 사전 검토 반영 (2026-10-09)

### D-1 전용 DB 계정 `collector_rw`
- `app_rw`(Vercel 함수)와 공유하지 않음 → GitHub 쪽이 새면 이 계정만 회수
- 권한(마이그레이션): `price_snapshot` SELECT·INSERT·UPDATE, `price_refresh` SELECT·INSERT·UPDATE, `fx_rate` SELECT·INSERT·UPDATE, `card_edition_link` SELECT. **`card_view_daily`·`daily_counter`·account 스키마 없음**
- `scripts/db-create-role.mjs` 목록에 추가: `connection limit 5`, 역할 기본값 `statement_timeout = 5s`
- 스크립트 시작 때 필요한 권한·금지 권한을 검사(없거나 넘치면 시작 거부, `api_rw`와 같은 방식)

### D-2 저장 용량과 보존 정책
- 실측(운영, 10/09): `price_snapshot` 1,968행 · 516KB → **행당 약 262바이트**(인덱스 포함), 카드당 평균 3.3행(판본·출처·버전), DB 전체 9.4MB
- 그대로 매일 2만 장을 받으면: 처음 약 6.6만 행(≈17MB) + 값이 바뀐 행만 새로 쌓임. TCGplayer 시장가는 소수점까지 자주 바뀌어 하루 50%가 바뀌면 **하루 약 3만 행(≈8MB) → 두 달이면 무료 한도 0.5GB**
- 대책
  1. **작은 변화는 새 행으로 남기지 않음**: 저장된 수준과 1% 미만 또는 0.02(그 통화 단위, $2·€2 미만 카드에서는 1%보다 큰 변동도 포함) 미만 차이면 같은 수준으로 보고 `last_seen_on`만 늘림 → 행이 크게 줄어듦. 화면의 대표 가격은 그날 받은 값이 아니라 **저장된 수준 값**(최대 1% 또는 2센트 차이)이고, 상세의 날짜별 표에 "작은 변동(1% 또는 2센트 미만)은 같은 값으로 보여요"라고 안내(qa K-2)
  2. **갱신 주기 단계화**(D-3과 같이): 매일 받는 카드는 스탠다드 + 1년 안에 나온 세트(약 5천 장), 나머지는 7일에 한 번(카드 id 해시로 요일 분산) → 하루 약 7천 장
  3. **오래된 이력 압축**(다음 단계): 180일이 지난 구간은 주 1행으로 합침(월 1회)
  4. **용량 경고**: 수집이 끝날 때 `pg_database_size`를 재서 350MB(70%) 넘으면 워크플로를 경고로 표시, 450MB 넘으면 수집 중단
- 예상: 대책 1·2로 하루 수천 행(1~2MB) 이하 → 1년 안쪽에서 한도 여유. 실제 증가량을 첫 2주 동안 기록해 이 문서에 갱신

### D-3 출처(TCGdex) 배려
- 요청 헤더 `User-Agent: card-dex-collector (+https://github.com/Yongb15/pokemon-cardgame)`
- 429·503이면 `Retry-After`를 지키고 지수 백오프, **429가 3번 연속이면 그날 수집 중단**
- 속도 상한: 동시 2개 + 요청 사이 400ms → 초당 약 3~4건
- 하루 대상 약 7천 장(위 단계화), 소요 약 40~60분
- 기존 방어 재사용: 고정 호스트, `redirect: 'error'`, 응답 1MB 상한, `cleanPrice`·단위 검사·DB CHECK
- 이용 안내: [TCGdex 문서](https://tcgdex.dev) — 무료·키 없음, 공식 요청 한도 공지 없음(받은 데이터는 우리 DB에 저장해 다시 요청하지 않음)

### 운영
- **끄는 방법**: `gh workflow disable collect-prices.yml` → Environment `prices-production` 비밀 삭제 → `collector_rw` 비밀번호 재설정(또는 `NOLOGIN`)
- 공개 저장소의 예약 워크플로는 저장소 활동이 60일 없으면 GitHub이 자동으로 끔 → 그때 다시 켜기
- Neon 계산 시간: 현재(10/08~09) 약 1.5시간 사용. 하루 1시간 추가는 월 30시간 안팎 → 무료 플랜 한도 안인지 첫 주 사용량으로 확인
- 저장소 Actions 설정을 "GitHub 제작 + 지정한 액션만 허용"으로(선택, 사용자 설정)
- 로그: 개수와 오류 이름만. 접속 주소에서 나온 값(호스트·사용자 이름)이나 pg 오류 메시지는 출력하지 않음
- **남는 위험(Security C-1, 수용)**: `collector_rw`는 DELETE는 못 하지만 UPDATE가 테이블 단위라, 계정이 새면 과거 행의 값을 바꿀 수 있다(표시 가격 오염, 공개 데이터라 다른 피해 없음). 대응: 비밀번호 재설정(또는 `NOLOGIN`) → Neon 복구 지점에서 되돌리기. 필요해지면 RLS로 UPDATE를 최근 14일 행으로 제한

### 운영 적용 순서
1. 운영 `collector_rw` 생성(`db-create-role.mjs`, 출력 없이 임시 파일) → 마이그레이션 0012 → 운영에서 권한 검사 missing·excess 모두 없음
2. GitHub Environment `prices-production`: Deployment branches = **Selected branches: main**(Protected branches 아님), 비밀 `PRICE_DATABASE_URL`은 이 Environment에만(저장소 Secrets에 같은 이름 없음)
3. develop → main 병합(PR) 뒤 `workflow_dispatch`로 첫 실행 1회: 로그가 개수만인지, DB 크기, 실패·429 여부
4. 첫 2주 동안 하루 증가량을 이 문서에 기록

> **이력**: 위의 GitHub Actions 실행(10/09~10/10)은 세 번 모두 중단돼 끄고 지웠다(워크플로 파일·Environment 삭제, `collector_rw` 비밀번호 재설정). 지금은 아래 Cloud Run Job으로 돈다. 구성 기록: `infra/collector/README.md`

## 실행 위치 변경: GitHub Actions → Cloud Run Job (2026-10-10)

### 왜
- GitHub에서 세 번 실행해 모두 중단: ① 끝에서 DB 오류(NeonDbError) ② 88장 처리 뒤 연속 실패 51건 + 429 2번 ③ 196장 중 131건 실패(SQLSTATE 없는 DB 오류) + TCGdex 429 3번 연속
- 같은 코드·같은 속도로 한국 PC → dev DB 300장은 실패 0, TCGdex 300/300 정상
- 판단: GitHub 러너(미국, 많은 사용자가 공유하는 IP)에서 ① 싱가포르 DB까지의 연결이 자주 실패하고 ② TCGdex가 공유 IP를 제한함. 제한은 우회하지 않음(Security)

### 어떻게
- **Cloud Run Job `price-collector`**(asia-southeast3 방콕, 계정 API와 같은 리전, DB와 가까움): 1 vCPU·512MiB, 작업 1개, 재시도 0, 제한 시간 110분
- **이미지**: `infra/collector/Dockerfile` — `scripts/collect-prices.ts` + `server/prices`·`server/db` + `data/index.json`·`tcgdex-map.json`·`sets.json`, 실행은 tsx. Artifact Registry `api` 저장소에 커밋 SHA 태그
- **비밀**: Secret Manager `collector-db-url`(운영 `collector_rw`) → Job 환경 변수 `PRICE_DATABASE_URL`. GitHub에는 더 이상 두지 않음(Environment 비밀 삭제)
- **실행 계정**: `collector-run` 서비스 계정 — 이 비밀 하나의 `secretAccessor`만
- **예약**: Cloud Scheduler(무료 3개) 매일 19:30 UTC → Job 실행. 호출 계정 `collector-scheduler`는 이 Job의 `run.invoker`만
- **비용**: Cloud Run Jobs 무료 한도(월 180,000 vCPU-초) 안 — 하루 1시간 = 월 약 108,000 vCPU-초. 예산 차단 장치(₩1,000) 그대로 적용
- **배포**: 처음은 `gcloud builds submit`(수동), 이후 GitHub Actions(WIF) 자동 배포는 별도 단계

### 전환 순서
1. GitHub 워크플로 끔(완료, 10/10). 기존 Vercel Cron은 계속
2. `collector_rw` 비밀번호 재설정(→ GitHub에 남은 값 무효) → 새 주소를 Secret Manager로(출력 없이)
3. GitHub Environment `prices-production`의 비밀 삭제
4. 이미지 빌드·Job·Scheduler 생성, 수동 실행 1회로 확인
5. DbError 라벨 보강: 이름 `DbError` + 원래 오류 이름·cause 코드(같은 안전 규칙)

### 적용 결과 (2026-10-10, Security J-1·J-2·R-1~R-5 반영)
- J-1: 빌드는 `infra/collector/stage.sh`로 필요한 추적 파일 21개만 임시 폴더에 복사해 업로드(`.env` 0개 확인), 이미지 안 무시 규칙은 `Dockerfile.dockerignore`. 루트 `.dockerignore`·`.gcloudignore`는 그대로
- J-2: 워크플로 파일 삭제, Environment `prices-production` 삭제, `collector_rw` 비밀번호 재설정(GitHub에 남았던 값 무효)
- R-1: 별도 AR 저장소 `collector`(immutable tags, 정리 규칙), Job은 digest로 지정 · R-2: 비밀 `:1` 고정, 1 task·재시도 0·110분 · R-3: Scheduler asia-southeast1 → Job asia-southeast3, OAuth(`collector-scheduler`, `run.invoker`만) · R-5: `DbError` 이름 + 내부 오류 라벨
- 첫 실행 `price-collector-94mvf`: 권한 검사 통과, 오늘 대상 5,525장 중 4,046장 수집 시작
