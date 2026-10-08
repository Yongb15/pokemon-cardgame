# ADR 0002 — 데이터베이스와 ORM

- 상태: 채택 (2026-10-08)
- 관련: M5 카드 시세, M6 로그인·DB, M7 경매

## 배경

시세 이력부터 시작해 회원·경매·포인트까지 저장해야 한다. 거래 데이터는 서로 엮여 있고(사용자·경매·입찰·포인트 기록) 정확해야 하며, 시세는 기간별 집계가 필요하다.

## 결정

- **PostgreSQL (Neon, 무료 플랜, 싱가포르)**
  - 관계형 + 트랜잭션: 포인트 장부·동시 입찰 처리에 필요
  - SQL 집계: 기간별 중앙값·이상치 제거
  - 무료 플랜이 일시정지되지 않음(Supabase는 7일 미사용 시 정지), DB 브랜치로 `production` / `dev` 분리
  - Firebase(Firestore)는 조인·집계·복잡한 트랜잭션이 약하고 백엔드 설계 경험을 보여주기 어려워 제외
- **Drizzle ORM + drizzle-kit 마이그레이션**
  - SQL에 가까운 타입 안전 쿼리, 서버리스(Neon HTTP 드라이버)와 이후 NestJS 서버 모두에서 사용 가능 → M5(Vercel Functions)와 M6(NestJS)이 같은 스키마·마이그레이션을 공유
  - 스키마는 `packages/shared`로 옮길 수 있게 한 곳(`db/schema.ts`)에 둔다
- **접속 규칙** (Security 권고)
  - `DATABASE_URL`은 서버 코드에서만 읽는다(`VITE_` 접두사 금지)
  - Vercel Production → Neon `production`, Preview·Development → `dev`
  - 앱은 최소 권한 역할(`app_rw`: 필요한 테이블의 SELECT/INSERT/UPDATE)로 접속, 소유자 역할은 로컬 마이그레이션에만
  - 파라미터 바인딩만 사용(문자열 이어 붙인 SQL 금지), DB 오류는 일반 500으로만 응답하고 주소·오류 내용을 응답·로그에 남기지 않음

## 결과

- 무료 용량 0.5GB 안에서 시세 이력을 쌓아야 하므로 **바뀐 값만 저장**하고 오래된 이력은 주 단위로 줄인다 → [시세 설계](../price/design.md)
