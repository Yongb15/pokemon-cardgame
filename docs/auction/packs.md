# 7b 카드팩·컬렉션 — 설계

M7(docs/auction/design.md)의 둘째 단계. 포인트로 카드팩을 열어 **가상 카드**를 모으고, 내 컬렉션에서 본다. 7c 경매에서 이 카드를 사고판다.

## 1. 카드팩

| 항목 | 값 |
|---|---|
| 세트 | 메가 진화 시리즈 6개: 메가 진화(me1), 팬텀 플레임(me2), 어센디드 히어로즈(me2pt5), 퍼펙트 오더(me3), 카오스 라이징(me4), 피치 블랙(me5). 구성이 같은 세트만(30주년 세트는 언커먼이 없어 제외) |
| 가격 | 1,000P (첫 보너스 10,000P = 10팩, 출석 500P = 이틀에 한 팩) |
| 구성 | 5장: 커먼 3 · 언커먼 1 · **레어 슬롯 1** |
| 레어 슬롯 확률 | 레어 60% · 더블 레어 18% · 일러스트 레어 12% · 울트라 레어 6% · 스페셜 일러스트 레어 3% · 하이퍼 레어 1% |
| 같은 등급 안 | 그 세트의 그 등급 카드 중 균등 |

- 세트에 없는 등급(예: 하이퍼 레어 없음)은 나머지 비율로 나눠 합이 100%가 되게. 메가 어택 레어는 울트라 레어 칸, 메가 하이퍼 레어는 하이퍼 레어 칸으로
- 확률표는 **서버 상수**(packages/shared가 아니라 API 코드)이고 화면에 그대로 공개. 팩 화면의 "확률표 보기"는 세트별로 계산된 값(없는 등급 반영)
- 추첨: `crypto.randomInt`. 슬롯마다 독립(같은 카드가 한 팩에 두 번 나올 수 있음 — 실물 팩과 같음)
- 카드 목록: 빌드 스크립트 `scripts/build-packs.mjs`가 `data/index.json`에서 6개 세트의 등급별 카드 id를 뽑아 `apps/api/src/packs/pool.json`으로(커밋, 약 1,000개 id). API는 카드 데이터 전체를 갖지 않는다

## 2. 데이터 (account 스키마, migration 0015)

| 테이블 | 열 | 메모 |
|---|---|---|
| `pack_openings` | id uuid, user_id, set_id, cost bigint, cards text[] (5), seeded bool, idem_key, created_at | 연 기록 = 감사 자료(분쟁·확률 검증). UNIQUE(user_id, idem_key) |
| `owned_cards` | id uuid, user_id, card_id, source(`pack`/`auction`/`test`), pack_id, auction_id(7c), acquired_at | 한 장 한 장 별개(경매 단위). 같은 카드 여러 장 = 여러 행 |

- CHECK: card_id 형식, cards 배열 길이 5, cost 1..1e8, source 화이트리스트
- 권한(Security A-1 방식): pack_openings SELECT + INSERT(열 지정) / owned_cards SELECT + INSERT(user_id, card_id, source, pack_id) — UPDATE(user_id, auction_id)는 7c에서. **DELETE 없음**(탈퇴는 FK 연쇄)
- 탈퇴: 본인 팩 기록·카드는 함께 삭제. 7c 이후 경매에 걸린 카드는 탈퇴를 막음(design §7)

## 3. 팩 열기 (한 트랜잭션)

```
BEGIN
  내 point_accounts 잠금 (7a lockAccount — 첫 보너스도 여기서)
  point_entries: pack_purchase −1,000, ref = 팩 id, idem_key = 'pack:<요청 id>'
     ON CONFLICT → 이미 처리된 요청: 그때 연 팩을 그대로 돌려줌 (재시도·연타 안전)
  잔액 − 보류 < 1,000 → 422 "포인트가 1,000P 필요해요 (N P 부족)"
  pack_openings 1행 + owned_cards 5행 (source 'pack', pack_id)
COMMIT
```
- 응답: 팩 id, 세트, 5장(카드 id·등급·레어 슬롯 표시), 새 잔액
- **연결이 끊겨도 복구**(qa): `GET /me/packs/latest`가 마지막으로 연 팩을 돌려줌 → 팩 화면에 들어오면 "방금 연 팩"으로 다시 보여 줌
- 제한: 쓰기 공통(분당 60) + 팩 열기 분당 10

## 4. 컬렉션

- `GET /me/collection?set=&page=` → 카드별로 묶어 `{ cardId, count, newest }`, 60개씩, 최근에 얻은 순 / 세트 필터
- `GET /me/collection/summary` → 총 장수, 서로 다른 카드 수, 세트별 모은 수(세트 완성도 "어센디드 히어로즈 87/295")
- 화면은 카드 정보를 기존 `/api/cards/batch`로 불러옴(서버는 id만)
- "덱과 컬렉션은 별개예요" 안내(카드를 팔아도 덱에서 빠지지 않음)

## 5. 화면 (docs/design/packs-7b.webp)

- `/packs`: 세트 6개 카드(로고·이름·1,000P·"확률표"), 열기 → 5장 공개
  - 공개 연출: 한 장씩 뒤집기(0.25초 간격), 레어 슬롯은 마지막·테두리 강조. `prefers-reduced-motion`이면 연출 없이 한 번에
  - 공개 뒤 5장을 목록으로 읽어 줌(스크린 리더), "컬렉션 보기"·"한 팩 더"
  - 포인트 부족: 버튼 옆 "N P 부족해요" + 출석 안내, 버튼은 이유와 함께 비활성
  - 320px: 5장 2~3열
- `/collection`: 요약(총 장수·서로 다른 카드·세트별 진행 막대), 카드 격자(같은 카드 ×N 배지), 세트 필터, 비었을 때 "카드팩을 열어 보세요" + 이동
- 로그아웃이면 둘 다 로그인 페이지로(next 유지)
- 진입: 계정 메뉴 "내 컬렉션 · 카드팩", 마이페이지 링크 (내비 "경매"는 7c에서)

## 6. qa용 장치 (Security T-1~T-6 그대로)

- `POST /api/v1/test/cards { cardId, count ≤ 20 }` — 테스트 계정, 실제 카드 id만(pool이 아니라 전체 카드 목록 기준), source 'test'
- 시드 추첨: `POST /me/packs { setId, idemKey, seed }`의 seed는 테스트 장치가 켜졌을 때만 받음, 그 팩은 `seeded = true`(확률 통계 제외)
- `GET /api/v1/test/pack-odds?set=` — 세트별 계산된 확률표(정적)

## 7. 테스트

- 확률: 시드 고정 난수로 10만 팩 → 등급별 비율이 표와 ±0.5%p 안, 세트에 없는 등급 0
- 원자성: 포인트 부족이면 카드 0장·장부 0줄, 같은 idem_key 두 번 → 팩 1개·차감 1번, 동시 5번 → 잔액만큼만 열림
- 장부 점검: 팩 연 뒤 ledger-check 일치
