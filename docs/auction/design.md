# M7 가상 포인트 경매 — 설계

사용자 결정(2026-10-10)
- 경매 대상: **가상 컬렉션 카드** — 실물·배송·결제 없이, 사이트 안에서 갖는 카드(실제 카드 데이터의 한 장)를 사용자끼리 포인트로 사고판다
- 포인트 얻기: **가입 보너스 + 매일 출석 + 가상 카드 팔기**
- 실시간: **SSE + 짧은 폴링** (Cloud Run 요청 10초 제한·무료 한도 안에서)

목표(포트폴리오): 돈처럼 다뤄야 하는 데이터를 **장부(ledger)** 로 정확하게, 경매를 **상태 머신**으로, 동시 입찰을 **트랜잭션과 잠금**으로 안전하게 처리하고 테스트로 증명한다.

## 1. 용어와 흐름

```
가입 ──▶ +10,000P (한 번)          출석 ──▶ +500P (하루 한 번, UTC가 아니라 KST 날짜)
  │
  ├─ 카드팩 열기 (1,000P) ──▶ 내 컬렉션에 카드 5장 (세트별, 희귀도 가중 추첨)
  │
  ├─ 내 카드 경매 등록 (시작가·기간) ──▶ 다른 사용자 입찰 ──▶ 마감 ──▶ 낙찰: 카드 이동 + 포인트 정산(수수료 5%)
  │                                                          └▶ 유찰: 카드 잠금 해제
  └─ 다른 사람 경매 입찰 ──▶ 입찰액만큼 포인트 "보류" ──▶ 더 높은 입찰이 오면 보류 해제
```

- 포인트는 현금 가치가 없고, 사거나 바꿀 수 없다(통신판매중개·결제 대상 아님). 화면과 약관에 명시
- 카드는 "가상 카드"이고 실물과 무관하다. 시세는 참고로만 보여 준다

## 2. 데이터 (account 스키마, `api_rw`)

### 포인트 장부
| 테이블 | 열 | 메모 |
|---|---|---|
| `point_entry` | id, user_id, amount(정수, ±), kind, ref_type, ref_id, idem_key, created_at | **추가만**(UPDATE·DELETE 권한 없음). 잔액 = 합 |
| `point_account` | user_id PK, balance, held, version | 장부 합의 캐시. `balance >= held >= 0` CHECK. 같은 트랜잭션에서 장부와 함께 갱신, 잠금 대상(FOR UPDATE) |

- kind: `signup_bonus` · `daily_bonus` · `pack_purchase` · `sale_income` · `sale_fee` · `purchase` · `admin_adjust`
- **보류(hold)** 는 장부가 아니라 `point_account.held`와 입찰 행으로 관리: 쓸 수 있는 포인트 = balance − held. 낙찰 때에만 장부에 `purchase`(−)·`sale_income`(+)·`sale_fee`(−, 판매자)를 쓴다
- `idem_key` UNIQUE(user_id, idem_key): 같은 요청 재시도로 두 번 지급·차감되지 않게(출석은 `daily:2026-10-11`, 팩은 클라이언트가 만든 요청 id)
- 매일 점검(테스트·관리 스크립트): `sum(point_entry) == point_account.balance`, held == 진행 중 경매의 내 최고 입찰 합

### 컬렉션과 카드팩
| 테이블 | 열 | 메모 |
|---|---|---|
| `owned_card` | id(uuid), user_id, card_id, acquired_at, source(`pack`/`auction`), auction_id(진행 중 경매에 잠겼으면) | 같은 카드도 한 장 한 장 별개(경매 단위) |
| `pack_opening` | id, user_id, set_id, cost, created_at | 연 기록(확률 검증·분쟁 대응) |

- 팩: 세트 하나에서 5장, 희귀도 가중(일반 3 · 언커먼 1 · 레어 이상 1, 레어 슬롯 안에서 상위 희귀도 낮은 확률). 확률표는 문서와 화면에 공개
- 추첨은 서버의 `crypto.randomInt`. 팩 세트는 스탠다드 세트 중 몇 개로 시작

### 경매와 입찰
| 테이블 | 열 | 메모 |
|---|---|---|
| `auction` | id, seller_id, owned_card_id(UNIQUE where open), card_id, start_price, min_step, status, starts_at, ends_at, original_ends_at, extensions, top_bid_id, top_amount, top_bidder_id, version, closed_at | 상태 머신(§3) |
| `bid` | id, auction_id, bidder_id, amount, created_at, idem_key | 추가만. UNIQUE(auction_id, bidder_id, idem_key) |
| `daily_claim` | user_id, day(KST) | PK — 출석 중복 방지 |

- 공개 화면에 보이는 것: 닉네임, 입찰액, 시각. 사용자 id·OAuth 정보는 보이지 않음

## 3. 경매 상태 머신

```
          create                       now ≥ ends_at, 입찰 있음
 (draft) ───────▶ OPEN ───────────────────────────────────────▶ SOLD
                   │  │  마감 2분 안 입찰 → ends_at = now+2분 (최대 10회)
                   │  └──────────────────────────────────────▶ UNSOLD (입찰 없음)
                   └── 판매자 취소(입찰 0건일 때만) ──────────▶ CANCELLED
```
- 허용 전이만 코드 한 곳(`transition()`)에서, DB에는 상태 CHECK + `version` 낙관적 잠금
- 마감 처리(정산)는 두 길: ① 마감 시각이 지난 경매를 읽거나 입찰하려는 요청이 같은 트랜잭션에서 정산 ② Cloud Scheduler가 5분마다 `POST /api/v1/internal/auctions/settle`(OIDC, 서비스 계정 하나만) — 아무도 안 보는 경매도 닫힘. 둘이 겹쳐도 `status = 'open'` 조건부 UPDATE라 한 번만 정산
- 기간: 1시간 · 24시간 · 3일 중 선택. 등록 한도: 진행 중 경매 사용자당 10개

## 4. 동시 입찰 (한 트랜잭션)

```
BEGIN
  SELECT … FROM auction WHERE id = $1 FOR UPDATE           -- 경매 행 잠금: 같은 경매 입찰은 줄을 선다
  검사: status = open, now < ends_at, bidder ≠ seller, amount ≥ max(start_price, top_amount + min_step)
  SELECT … FROM point_account WHERE user_id IN (bidder, prev_top) ORDER BY user_id FOR UPDATE
                                                             -- 항상 같은 순서로 잠가 교착 방지
  검사: bidder.balance − bidder.held (+ 이미 내가 최고 입찰자면 내 이전 보류) ≥ amount
  bidder.held += amount (자기 최고 입찰 갱신이면 차액만), prev_top.held −= prev_amount
  INSERT bid; UPDATE auction SET top_* , ends_at(연장), version+1
COMMIT
```
- 경매 행을 먼저, 그다음 사용자 행을 id 순서로 → 잠금 순서 고정
- 같은 요청 재시도는 idem_key로 같은 결과
- 테스트: 실제 Postgres(Neon dev 브랜치에서 일회용 브랜치)로 **동시 입찰 50건**을 Promise.all로 보내 최종 최고 입찰·보류 합·장부 합이 맞는지, 교착·이중 보류 0

## 5. 실시간 (SSE + 폴링)

- `GET /api/v1/auctions/:id/events` (SSE): 최고 입찰·마감 시각이 바뀌면 이벤트. Cloud Run 요청 10초 제한 때문에 **서버가 8초 뒤 스트림을 닫고**, 브라우저 EventSource가 `retry: 1000`으로 다시 연결(사실상 긴 폴링). 연결마다 `version`을 보내 바뀐 것만
- 변경 감지: 인스턴스가 최대 2개라 메모리 이벤트만으론 부족 → 연결 동안 1초 간격으로 `version`만 읽는 가벼운 쿼리(경매 행 PK 조회). 동시 접속이 늘면 Postgres LISTEN/NOTIFY로 교체
- **먼저 확인할 것**(7d 첫 작업): Vercel middleware 프록시가 스트리밍 응답을 그대로 흘려보내는지. 안 되면 3초 폴링(ETag/304)만 사용
- 탭이 안 보이면 연결을 끊음(Page Visibility)

## 6. 화면

- `/market` 경매 목록(마감 임박순·새로 등록·세트·가격 필터), `/auctions/:id` 상세(카드·현재가·남은 시간·입찰 기록·입찰 상자·참고 시세), `/collection` 내 카드(경매 등록), `/packs` 카드팩, 마이페이지 포인트(잔액·보류·내역)
- 헤더에 포인트 잔액, 출석 버튼(오늘 받았으면 숨김)
- 카드 상세에 "이 카드 경매 N건" 링크

## 7. 보안·남용

- 모든 쓰기: 로그인 + 기존 CSRF(Origin) + 사용자별 쓰기 제한(분당 60) + 입찰은 별도로 분당 20
- 금액은 정수 포인트, 상한 1억P, 입력은 zod로 정수·범위
- 다중 계정(구글+카카오로 보너스 두 번)·자전 입찰은 가상 포인트라 받아들임 — 문서화. 단, 같은 사용자의 자기 경매 입찰은 막음
- 관리자 조정(`admin_adjust`)은 소유자 스크립트로만, API 없음
- 탈퇴: 진행 중 경매 판매자·최고 입찰자면 탈퇴 전에 안내(경매 종료 후 가능) — 장부는 사용자 삭제 시 함께 삭제(가상 포인트, 개인정보 최소화)
- 개인정보처리방침에 포인트·컬렉션·입찰 기록 항목 추가

## 8. 단계 (각 단계 qa + Security)

| 단계 | 내용 |
|---|---|
| 7a | 포인트 장부: 테이블·권한, 가입 보너스(기존 사용자 포함 한 번)·출석, 마이페이지 포인트 내역, 장부 점검 테스트 |
| 7b | 컬렉션·카드팩: 팩 열기(확률 공개), 내 컬렉션 |
| 7c | 경매: 등록·목록·상세·입찰(동시성 테스트)·마감 정산(Scheduler)·취소 |
| 7d | 실시간(SSE 확인 → 폴링 대체), 알림(최고 입찰자에서 밀림, 낙찰) |
| 출시 | v1.5.0 |

ERD·ADR: `docs/adr/0005-points-ledger-and-auctions.md`
