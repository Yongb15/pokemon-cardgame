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
  - 비밀 값은 GitHub **Environment `prices-production`**에만 둠: `PRICE_DATABASE_URL`(운영 `app_rw`, 시세 테이블만 읽고 쓰는 기존 계정). Environment는 `main` 브랜치에서만 쓸 수 있게 제한 → 다른 브랜치·포크 PR의 워크플로는 비밀에 접근 불가
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
- 운영 DB 접속 주소를 GitHub에 맡김: 최소 권한 `app_rw`(account 스키마 접근 불가), Environment + main 브랜치 제한, 로그 출력 금지
- 워크플로 주입: 외부 입력(이슈·PR 제목 등)을 쓰지 않음, `pull_request_target` 없음
- 공급망: 액션 SHA 고정, `npm ci --ignore-scripts`

## 다음
- 수집이 쌓이면 시세 탭 문구를 "전체 카드 기준"으로, 2주 뒤 7일 상승·하락 순위
