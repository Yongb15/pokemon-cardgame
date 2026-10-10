# PSA 등급 시세 (M5.3)

카드 시세는 보통 PSA 등급(PSA 10·9·8)으로 이야기한다. 지금 보여 주는 TCGplayer·Cardmarket 값은 등급이 없는(raw) 카드 가격이라, 비싼 카드일수록 실제로 오가는 값과 차이가 크다. 이 단계에서는 비싼 카드의 **PSA 등급별 실제 판매가**를 모아 상세와 시세 탭에 보여 준다.

## 출처: Pokemon Price Tracker (무료 플랜)

- API `GET https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=<id>&includeEbay=true`, 헤더 `Authorization: Bearer <키>`
- 응답의 `ebay.salesByGrade.psa10 | psa9 | psa8`: 판매 건수, 평균·중앙값·최저·최고, 마지막 판매일, 7일 시장가, 추세. eBay·Fanatics Collect 판매 기록 기반
- 카드 찾기: TCGdex 카드 응답의 `pricing.tcgplayer.<variant>.productId`(이미 수집 중인 응답). 응답의 `externalCatalogId`가 TCGdex id와 같아 연결 확인에 사용
- **비용**: 카드 1장 = 기본 1 + eBay(등급) 1 = **2크레딧**(실측: `x-api-calls-consumed: 2`). 무료는 하루 100크레딧, 분당 60회, 매일 0시 UTC에 초기화

### 약관 확인 (2026-08-19 개정판, [terms](https://www.pokemonpricetracker.com/terms) · [licensing](https://www.pokemonpricetracker.com/licensing))

| 조항 | 내용 | 우리 쪽 대응 |
|---|---|---|
| 무료 플랜 범위 | 개인·취미, "수익이 전혀 없는 무료 도구" | 광고·제휴·후원·유료 기능 없음. **PSA 시세를 로그인 뒤에 숨기지 않음**(로그인 전용 기능은 수익으로 봄) |
| 저장·캐시 | 우리 서비스에 쓰려고 저장하는 건 허용, 받은 데이터는 계속 보관 가능, 오래된 값을 보여 주지 말 것 | DB에 저장해 화면에만 사용, 주 1회 갱신하고 날짜를 함께 표시 |
| 금지 | 원본 데이터 되팔기·재배포, 저장본을 제3자에게 데이터 출처로 제공, 스크래핑 | 우리 API는 우리 화면 전용(문서·README에 "공개 API"로 소개하지 않음), 응답은 화면에 필요한 요약값만 |
| 출처 표기 | 의무 아님(권장) | 상세 화면에 "PSA 시세: Pokemon Price Tracker(eBay·Fanatics 판매 기록)" 링크 |
| 한도 | 플랜 한도 초과 금지 | 하루 사용량을 응답 헤더로 확인하고 90크레딧에서 멈춤 |

## 수집 대상과 주기

- 대상: 저장된 TCGplayer 시장가(판본 중 최고가)가 **$50 이상**인 카드, 가격 순 상위 **315장**(2026-10-10 기준 $50 이상 324장)
- 하루 **45장**(90크레딧, 10크레딧 여유) × 7일 = 315장 → 카드마다 **주 1회** 갱신. 대상 목록은 그날의 가격 순서로 다시 뽑고, 마지막 PSA 수집이 오래된 순으로 처리
- 실행: 기존 Cloud Run Job `price-collector`의 마지막 단계(TCGdex 수집 뒤). 하루 대상이 정해져 있어 오래 걸리지 않음(45건 × 1.5초 간격 ≈ 1분)
- 실패: 429면 그날 PSA 단계 중단, 401·403(키 문제)이면 중단하고 종료 코드로 알림. 실패 라벨은 기존 규칙대로 상수만 기록

## 저장

새 테이블 `psa_price`(마이그레이션 0013), 수집할 때마다 등급별 한 줄:

| 열 | 타입 | 설명 |
|---|---|---|
| card_id | text | 우리 카드 id (길이 1~40) |
| grade | text | `psa10` · `psa9` · `psa8` |
| captured_on | date | 받은 날(UTC) |
| median | numeric(12,2) USD | 판매 중앙값(대표값) |
| sales | int | 집계에 쓰인 판매 건수 |
| last_sale_on | date | 마지막 판매일 |
| low · high | numeric(12,2) | 최저·최고 판매가 |

- PK `(card_id, grade, captured_on)`, 값 범위 CHECK(0~1,000,000), 등급 CHECK
- 판매 3건 미만인 등급은 저장하지 않음(값이 한두 건 거래로 튐)
- 용량: 315장 × 3등급 × 주 1회 × 52주 ≈ 4.9만 행/년 ≈ 13MB
- 권한: `collector_rw`에 SELECT·INSERT·UPDATE(삭제 없음), 웹 시세 함수 `app_rw`에 SELECT만
- 수집 상태: `psa_refresh(card_id, refreshed_at, status)` — 오래된 순 선택과 실패 기록

## 비밀 값

- API 키: Secret Manager `pricetracker-api-key`(asia-southeast1, 버전 고정), Job에 `PRICETRACKER_API_KEY`로만 연결. 접근 권한은 수집기 실행 계정(`collector-run`)에만
- Vercel 함수는 키를 갖지 않음(화면은 DB에서만 읽음)
- 키는 로그·오류 메시지·채팅에 남기지 않음. 요청 실패 라벨은 `HTTP 401` 같은 상수만

## 화면

- **카드 상세**: 시세 박스 아래 "PSA 등급 시세" 블록 — PSA 10·9·8 중앙값(원화 환산 + 달러), 판매 건수, 마지막 판매일, 수집일. 등급별 이력은 점 2개 이상이면 작은 선 그래프. 대상이 아닌 카드는 "PSA 시세는 $50 이상 카드만 모아요"
- **시세 탭**: "PSA 10" 보기 추가(가격 순 TOP 50)
- 원화 환산은 기존 환율(Frankfurter)을 그대로 사용
- 출처 링크와 "eBay·Fanatics 실제 판매 기준, 참고용" 안내

## 진행 순서

1. 이 문서 + 화면 시안 → Security 검토(약관 해석, 키 관리, 저장 범위)
2. 마이그레이션 0013(테이블·권한) → 수집 단계(개발 DB로 소량 시험) → 화면
3. qa 검수(값 대조: 응답 원본 ↔ 저장값 ↔ 화면) → develop → v1.4.0
