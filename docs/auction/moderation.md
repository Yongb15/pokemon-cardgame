# 신고와 관리자 화면 (M8) — 설계

경매에서 시세 조작·현금 거래(RMT) 유도 같은 금지 행위를 사용자가 신고하고, 운영자가 확인해 경매를 내리거나 신고를 닫는다. 약관 §4의 "확인되면 되돌리거나 제한할 수 있다"를 실제로 할 수 있게 하는 최소한의 도구.

## 1. 무엇을 신고하나
- **경매만**. 다른 사용자의 닉네임은 어디에도 보이지 않으므로(A-3) 사용자·닉네임 신고는 없음
- 사유는 고르기만: `price_manipulation`(가격 조작 의심 — 같은 사람이 여러 계정으로 입찰 등), `rmt`(현금 거래 유도), `wrong_item`(카드·설명이 이상함), `other`. 설명은 선택, 200자, 그대로 저장하되 **관리자 화면에서만** 글자로(HTML 아님) 표시
- 한 사람이 같은 경매를 한 번만(PK user+auction), 하루 10건까지, 자기 경매는 신고 불가. 진행 중·끝난 경매 모두 가능(끝난 뒤 알게 되는 조작)
- 신고자는 다른 누구에게도 보이지 않음(판매자·입찰자에게 신고 사실도 알리지 않음). 관리자 화면에도 신고자는 "신고자 1·2…"로만(경매별 번호), 사용자 id 없음

## 2. 관리자
- `account.admins(user_id PK → users cascade, created_at)` — **소유자 계정이 SQL로만** 넣고 뺀다. `api_rw`는 SELECT만(INSERT·UPDATE·DELETE 없음, 시작 시 검사). 앱에는 "관리자 되기" 경로가 없음
- 관리자 라우트는 매 요청마다 세션 + admins 확인, 아니면 **404**(존재를 숨김). 쓰기는 Origin 검사 + 분당 20회
- 운영에서 관리자 계정은 사용자(운영자) 한 명. 미리보기에서는 테스트 계정을 소유자 SQL로 지정해 qa

## 3. 관리자 화면 `/admin` (docs/design/moderation.webp)
- 열린 신고가 있는 경매 목록(신고 수·사유별 수·첫 신고 시각, 오래된 순) → 경매 하나를 열면: 카드, 상태, 시작가·현재가, 입찰 기록(별칭·금액·시각, 같은 경매 안에서만 의미 있는 별칭), 신고 목록(사유·설명·시각, 신고자 번호)
- 조치 두 가지(둘 다 이유 한 줄 필수, `admin_actions`에 기록):
  1. **신고 닫기**(문제 없음) — 그 경매의 열린 신고를 모두 `dismissed`
  2. **경매 내리기**(진행 중일 때만) — 입찰이 있어도 취소: 최고 입찰자의 묶인 포인트를 풀고, 카드를 판매자에게 되돌리고, `status = 'cancelled'`(기존 상태, 장부 기록 없음 — 돈이 오가지 않았으므로). 열린 신고는 `actioned`. 판매자·최고 입찰자에게 알림 `removed`("운영 정책에 따라 경매가 내려졌어요", 이유 문구는 보내지 않음)
- 끝난(낙찰된) 경매를 되돌리는 것(포인트·카드 회수)은 이번 범위 밖: 장부에 반대 기록을 남기는 별도 설계가 필요. 신고만 닫거나 기록으로 남김
- 사용자 정지(로그인 막기)도 범위 밖 — 필요해지면 따로

## 4. 데이터 (마이그레이션 0021)
- `auction_reports(user_id → users cascade, auction_id → auctions, reason, note ≤200, status open|dismissed|actioned, created_at, resolved_at)`, PK (user, auction)
- `admins(user_id PK)`
- `admin_actions(id, admin_id → users set null, auction_id, action dismiss|remove, reason ≤200, created_at)` — 추가만(UPDATE·DELETE 권한 없음), 탈퇴해도 기록은 남고 관리자 id만 비워짐
- `notifications` 종류에 `removed`
- 권한 `api_rw`: auction_reports SELECT·INSERT(user_id, auction_id, reason, note)·UPDATE(status, resolved_at), admins SELECT, admin_actions SELECT·INSERT(admin_id, auction_id, action, reason). 각각 초과 권한 목록(테이블별)

## 5. 경매 내리기의 잠금
- 기존 순서 그대로: (1) 경매 행 FOR UPDATE → (2) 최고 입찰자 포인트 계정 → (3) 카드 → (4) 알림·신고·관리 기록(쓰기만). 진행 중이 아니거나(마감 시각 지남 포함) 이미 끝났으면 거부 — 마감 직후라면 정산이 먼저(지연 정산과 같은 경로)
- 입찰·정산·내리기 동시 점검: 결과 하나, 장부 불변식(묶인 금액 = 내 진행 중 최고 입찰 합) 유지

## 6. API
- 사용자: `POST /me/auctions/:id/report { reason, note? }` → 201(이미 신고 200 같은 응답, 자기 경매 403, 없는 경매 404, 하루 10건 429)
- 관리자(아니면 404): `GET /admin/reports` → 경매별 묶음 · `GET /admin/auctions/:id` → 상세 + 신고 · `POST /admin/auctions/:id/dismiss { reason }` · `POST /admin/auctions/:id/remove { reason }` · 모두 no-store
- 공개 응답에는 신고 수·신고 여부 없음
