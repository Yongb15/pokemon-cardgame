# 가격 알림 (M8) — 설계

관심 카드에 "이 가격 이하가 되면 알려 줘"를 걸어 두면, 대표 시세(원화)가 그 아래로 내려왔을 때 알림 종(7d)으로 알려 준다. 이메일·푸시는 없음(새 개인정보 없음).

## 1. 흐름
1. 카드 상세 시세 블록의 **"가격 알림"** → 목표가 입력(기본: 지금 시세의 90%, 100원 단위) → 저장
2. 사용자가 사이트에 들어와 알림 목록을 읽을 때(`GET /me/notifications`) **그 사용자의 알림만** 확인 — 마지막 확인이 1시간 넘었으면 시세를 받아 비교
3. 지금 시세 ≤ 목표가 → 알림 `price` 1건(카드·현재 시세·목표가) + 그 가격 알림은 **꺼짐**(한 번만 울림, 다시 켜면 재사용)
4. 관심 카드 페이지에 "가격 알림" 열: 목표가·지금 시세·상태(대기/울림), 수정·삭제

이유: Cloud Run은 요청이 없으면 0대로 줄어 서버 안 타이머가 돌지 않는다(경매는 지연 정산으로 해결한 것과 같은 방식). 알림은 사이트 안에서만 보이므로 "들어왔을 때 확인"이면 충분하고, 비용이 0에 가깝다.

## 2. 시세는 어디서
- 계정 API(`api_rw`)는 시세 테이블 권한이 없고, 원화 환산·대표 시세 규칙은 TS 코드(`server/prices/`)에 있다 → **공개 시세 함수에 새 일괄 조회** `GET /api/prices/batch?ids=a,b,c` 추가(정렬·중복 없는 카드 id 1~50개, 아니면 400; 응답 `{ today, prices: { id: krw } }`, 엣지 1시간 캐시). 공개 데이터라 누구나 부를 수 있음
- 계정 API가 이 주소를 서버에서 호출(고정 호스트 `PUBLIC_ORIGIN`, `redirect: 'error'`, 3초 제한, 응답 64KB 상한, 숫자만 받아들임). 실패하면 이번 확인은 건너뜀(다음 방문에 다시)
- 사용자 정보는 보내지 않는다: 카드 id 목록만, 쿠키·헤더 없음

## 3. 데이터 (account 스키마, 마이그레이션 0019)
- `price_alerts(user_id → users cascade, card_id, target_krw int 100~100,000,000 · 100단위, active bool, created_at, triggered_at null)`, PK `(user_id, card_id)`, 사용자당 50개(advisory lock 안에서 세기, 덱 100개와 같은 방식)
- `alert_checks(user_id PK → users cascade, checked_at)` — 1시간에 한 번만 확인(여러 탭·연타에도 시세 호출 1번: `INSERT … ON CONFLICT DO UPDATE … WHERE checked_at < now() - 1h RETURNING`으로 선점)
- `notifications`: `auction_id` NULL 허용, kind에 `price` 추가, CHECK `(kind = 'price') = (auction_id is null)`. `price`는 `(user_id, card_id) where kind = 'price'` 부분 유일 → 다시 울리면 같은 행이 최신 값·안 읽음으로
- 권한 `api_rw`: price_alerts SELECT·INSERT·UPDATE(target_krw, active, triggered_at)·DELETE(본인 것 삭제 기능), alert_checks SELECT·INSERT·UPDATE(checked_at). 시작 시 권한 검사에 추가

## 4. API (모두 로그인, 쓰기는 Origin 검사·분당 60회)
- `GET /me/price-alerts` → `{ alerts: [{ cardId, targetKrw, active, triggeredAt }] }`
- `PUT /me/price-alerts/:cardId { targetKrw }` → 만들기/수정(다시 켜짐), 50개 초과 422, 없는 카드 404
- `DELETE /me/price-alerts/:cardId` → 204
- `GET /me/notifications`: 경매 정산 뒤 가격 알림 확인(1시간 선점) → 목록

## 5. 화면 (docs/design/price-alert.webp)
- 상세 시세 블록 오른쪽 위 "가격 알림"(로그인 안 했으면 로그인으로) → 작은 대화상자: 지금 시세, 목표가 입력(₩, 100원 단위), "이 가격 이하가 되면 알림 종으로 알려 드려요 · 하루 한 번 모으는 시세 기준"
- 걸려 있으면 버튼이 "알림 ₩xx 이하"로 바뀜
- 알림 문구: "**리자몽 ex** 시세가 ₩42,000이 됐어요 (목표 ₩45,000 이하)" → 카드 상세로
- 관심 카드 페이지: 알림 건 카드에 목표가·상태 표시

## 6. 남용·보안
- 시세 호출은 사용자당 1시간 1번, 카드 50개 → 일괄 1번(50개 상한)
- 일괄 조회는 공개 데이터만, 파라미터 엄격(정렬·중복·개수·형식), 캐시 키 = 정렬된 id 목록
- 알림 문구에 다른 사용자 정보 없음
