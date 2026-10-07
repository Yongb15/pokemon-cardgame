# Pokémon Card Dex

포켓몬 트레이딩 카드 게임(TCG)의 카드를 검색하고, 필터링하고, 상세 정보를 볼 수 있는 웹 도감입니다.
이후 덱 빌더 기능으로 확장할 예정입니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프레임워크 | React 19 + TypeScript |
| 빌드 도구 | Vite |
| 라우팅 | React Router 7 (`/`, `/cards/:id`, 404) |
| 스타일 | CSS Modules, CSS 변수 (라이트/다크) |
| 린트 | oxlint |
| 데이터 | [Pokémon TCG API v2](https://docs.pokemontcg.io/) |

## 진행 상황

- [x] 프로젝트 초기 세팅 (Vite + React + TypeScript, API 클라이언트, 카드 타입 정의)
- [x] 카드 목록 + 페이지네이션 (모바일은 "더 보기")
- [x] 이름 검색 (입력 지연 처리, `/` 단축키)
- [x] 필터 (타입, 세트, 희귀도) + 정렬, URL에 상태 저장
- [x] 로딩 / 결과 없음 / 오류 / 응답 지연 상태
- [x] 반응형 레이아웃 / 다크 모드
- [x] 카드 상세 페이지 (기술·특성, 약점·저항, 세트 정보, 대회 규정, 시세, 같은 세트 이전/다음, 다른 버전 카드)
- [ ] 카드 데이터 자체 보유 (pokemontcg.io API 2027년 3월 종료 대비) + 한국어 카드 이름
- [x] 배포 (Vercel, develop 미리보기)
- [ ] 덱 빌더

## 데모

**https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app** (develop 브랜치, push할 때마다 자동 배포)

정식 주소 https://pokemon-card-dex-green.vercel.app 은 `main` 브랜치 기준이라, 기능이 완성되어 `main`에 병합된 뒤에 열립니다.

## 주요 기능

- **검색과 필터**: 카드 이름(영문) 부분 검색, 타입·세트·희귀도 필터, 4가지 정렬
  - API가 거부하는 문자(한글, " ( 등)는 요청 전에 걸러내고, 한글 검색에는 영문 검색 안내를 표시
- **URL 상태**: 검색어·필터·페이지가 주소에 저장되어 새로고침, 링크 공유, 뒤로 가기가 그대로 동작
- **불안정한 API 대응**: 요청의 상당수가 500/502로 실패하는 API라 다음을 적용
  - 같은 출처 프록시(Vercel Function `api/tcg.ts`)가 API 가까이에서 먼저 재시도하고, 성공 응답은 Vercel 엣지에 1시간 캐시(모든 방문자가 공유)
  - 일시적 오류는 최대 4회 재시도(지수 백오프), 요청 전체 마감 시간 25초
  - 성공한 응답은 10분간 메모리에 캐시
  - 세트·희귀도 목록은 앱에 스냅샷(src/data)을 포함해 API가 멈춰도 필터가 동작하고, 최신 목록은 백그라운드로 받아 하루 동안 localStorage에 캐시
  - 5초 이상 걸리면 "응답이 늦어지고 있어요" 안내, 최종 실패 시 다시 시도 버튼
  - 검색어나 필터가 바뀌면 이전 요청은 즉시 취소(AbortController)
- **반응형**: 6열 → 2열 그리드, 모바일에서는 필터 패널과 "더 보기" 방식
- **접근성**: 키보드 조작, `aria-pressed`/`aria-current`, 스크린 리더용 결과 수 알림, 움직임 줄이기 설정 존중

## 디자인

[Figma: Pokémon Card Dex](https://www.figma.com/design/n7tkM2aFBRJs43Qe9fNIwS) — 카드 목록·카드 상세의 데스크톱, 모바일, 상태(로딩·없음·오류) 화면.
상세 화면 시안은 [docs/design](docs/design)에도 이미지로 보관합니다.

## 시작하기

Node.js 20.19 이상 또는 22.12 이상이 필요합니다 (Vite 8 요구 사항).

```bash
npm install
npm run dev       # 개발 서버 (기본 http://localhost:5173)
npm run build     # 타입 검사 + 프로덕션 빌드
npm run lint      # 린트
```

5173 포트가 이미 사용 중이면 Vite가 다른 포트를 자동으로 고릅니다. 터미널에 표시된 주소로 접속하세요.

### API 키 (선택)

키 없이도 동작하지만, 키를 넣으면 요청 한도가 늘어납니다.
[dev.pokemontcg.io](https://dev.pokemontcg.io)에서 무료로 발급받아 Vercel 프로젝트의 **Settings → Environment Variables**에
`POKEMON_TCG_API_KEY`로 등록하세요. 키는 서버 함수(`api/tcg.ts`)에서만 쓰이고 브라우저로 전달되지 않습니다.

## 폴더 구조

```
api/
└─ tcg.ts        # Vercel Function: Pokémon TCG API 프록시 (재시도, 엣지 캐시, API 키 보관)
src/
├─ api/          # Pokémon TCG API 클라이언트 (재시도, 타임아웃, 캐시)
├─ components/   # Header, SearchBar, TypeFilter, CardTile, Pagination, 상태 화면, detail/(상세 섹션) 등 (CSS Modules)
├─ hooks/        # useCardSearch, useApiResource, useFilterOptions, useUrlParams, useMediaQuery, useDebouncedValue
├─ lib/          # 필터 ↔ URL ↔ API 쿼리 변환, 타입 이름·색상, 페이지 번호 계산
├─ pages/        # CardListPage, CardDetailPage(/cards/:id), NotFoundPage
├─ types/        # API 응답 타입 정의
├─ App.tsx
├─ main.tsx
└─ index.css     # 전역 스타일, 색상 변수 (라이트/다크)
```

## 브랜치 전략

```
main        ← 기능이 모두 완성됐을 때 병합 (배포 기준)
 └ develop  ← 기능 통합 브랜치
    └ feature/<기능명>  ← 기능 단위 작업
```

## 출처

카드 데이터와 이미지는 Pokémon TCG API에서 제공합니다.
Pokémon 및 관련 상표는 Nintendo, Creatures, GAME FREAK, The Pokémon Company의 자산이며, 이 프로젝트는 학습·포트폴리오 목적의 비공식 팬 프로젝트입니다.
