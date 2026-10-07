# Pokémon Card Dex

포켓몬 트레이딩 카드 게임(TCG)의 카드 20,000여 장을 한국어·영어로 검색하고, 필터링하고, 상세 정보를 볼 수 있는 웹 도감입니다.
이후 덱 빌더 기능으로 확장할 예정입니다.

## 데모

**https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app** (develop 브랜치, push할 때마다 자동 배포)

정식 주소 https://pokemon-card-dex-green.vercel.app 은 `main` 브랜치 기준이라, 기능이 완성되어 `main`에 병합된 뒤에 열립니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프레임워크 | React 19 + TypeScript |
| 빌드 도구 | Vite |
| 라우팅 | React Router 7 (`/`, `/cards/:id`, 404) |
| 스타일 | CSS Modules, CSS 변수 (라이트/다크) |
| 서버 | Vercel Functions (`api/cards.ts`) |
| 데이터 | 자체 보유 카드 데이터 ([pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)) + 한국어 이름 ([PokéAPI](https://github.com/PokeAPI/pokeapi)) |
| 린트 | oxlint |

## 진행 상황

- [x] 프로젝트 초기 세팅 (Vite + React + TypeScript)
- [x] 카드 목록 + 페이지네이션 (모바일은 "더 보기")
- [x] 이름 검색 (입력 지연 처리, `/` 단축키)
- [x] 필터 (타입, 세트, 희귀도) + 정렬, URL에 상태 저장
- [x] 로딩 / 결과 없음 / 오류 / 응답 지연 상태
- [x] 반응형 레이아웃 / 다크 모드
- [x] 카드 상세 페이지 (기술·특성, 약점·저항, 세트 정보, 대회 규정, 같은 세트 이전/다음, 다른 버전 카드)
- [x] 배포 (Vercel, develop 미리보기)
- [x] 카드 데이터 자체 보유 + 한국어 카드 이름·한국어 검색
- [ ] 덱 빌더

## 주요 기능

- **한국어·영어 검색**: "리자몽", "메가 리자몽", "Charizard" 모두 검색. 띄어쓰기·대소문자·악센트(Flabébé)를 무시하고 부분 일치
- **한국어 카드 이름**: 공식 한국어 포켓몬 이름으로 카드 이름을 번역(포켓몬 카드의 99.9%). 예) Charizard ex → 리자몽 ex, Iron Hands ex → 무쇠손 ex
- **필터와 정렬**: 타입·세트·희귀도 필터, 최신/오래된 세트순·이름순·번호순
- **URL 상태**: 검색어·필터·페이지가 주소에 저장되어 새로고침, 링크 공유, 뒤로 가기가 그대로 동작
- **카드 상세**: 큰 이미지 뷰어, 기술과 특성(에너지 비용), 약점·저항력·후퇴, 세트 정보, 대회 사용 가능 여부, 같은 세트의 이전/다음 카드, 같은 포켓몬의 다른 카드
- **탐색 흐름 유지**: 상세에서 "카드 목록"으로 돌아오면 필터·페이지·스크롤 위치(모바일 "더 보기"로 쌓은 목록 포함)가 그대로 복원
- **반응형·접근성**: 6열 → 2열 그리드, 키보드 조작, 스크린 리더 레이블, 움직임 줄이기 설정 존중, Lighthouse 접근성·권장사항 100점

## 외부 API 종료에 대비한 데이터 자체 보유

처음에는 [Pokémon TCG API](https://pokemontcg.io)를 브라우저에서 직접 호출했지만, 다음 문제가 있었습니다.

1. **불안정**: 요청의 절반가량이 500/502로 실패(CORS 헤더도 없어 브라우저에서는 원인조차 보이지 않음)
   → 클라이언트 재시도·타임아웃·캐시, 이어서 같은 출처 프록시(Vercel Function)로 서버 쪽 재시도와 엣지 캐시를 도입
2. **서비스 종료**: 이 API는 **2027년 3월 1일 종료**되고, 후속 서비스(Scrydex)는 유료
   → API가 쓰던 공개 데이터를 직접 보유하고, 우리 서버 함수가 그 데이터로 응답하도록 전환

현재 구조:

```
scripts/build-data.mjs ──(고정된 커밋에서 다운로드)──> data/ (카드 20,635장, 세트 176개, 한국어 이름)
                                                          │
브라우저 ──> /api/cards (Vercel Function, server/cardsApi.ts) ──┘  응답은 엣지에 하루 캐시
```

- 외부 API 의존이 없어져 오류가 사라졌고, 검색 응답이 수 ms로 빨라졌습니다.
- 데이터 원본은 커밋 해시로 고정해 언제 다시 만들어도 같은 결과가 나옵니다(`data/meta.json`).
- 한계: 시세(가격) 정보는 원본 데이터에 없어 제외했습니다. 카드 이미지는 아직 원래 이미지 서버를 사용합니다.

## 개발 방식

[Claude Code](https://claude.com/claude-code) 세션 두 개로 역할을 나눠 개발했습니다.

| 세션 | 역할 |
|---|---|
| code | 기획 정리, Figma 디자인, 구현, 커밋·배포 |
| qa | 검증과 버그 리포트만 담당(코드는 수정하지 않음) — 실제 배포 URL과 브라우저 자동화로 레이아웃·라우팅·접근성·엣지 케이스 확인 |

- 기능마다 **Figma 디자인 → `feature/*` 브랜치 구현 → qa 검증 → 수정 → 재검증 → `develop` 병합** 순서로 진행
- qa 리포트는 재현 방법·기대/실제 결과·파일 위치·심각도로 정리되고, 모든 지적 사항을 수정한 뒤 재검증을 통과해야 병합
- 예) 카드 목록 1차 검증에서 12건(한글 검색이 서버 오류로 보이는 문제, 스크롤 앵커링으로 페이지 이동이 되돌아가는 문제, 색 대비 등)을 찾아 모두 수정

## 디자인

[Figma: Pokémon Card Dex](https://www.figma.com/design/n7tkM2aFBRJs43Qe9fNIwS) — 카드 목록·카드 상세의 데스크톱, 모바일, 상태(로딩·없음·오류) 화면.
상세 화면 시안은 [docs/design](docs/design)에도 이미지로 보관합니다.

## 시작하기

Node.js 20.19 이상 또는 22.12 이상이 필요합니다 (Vite 8 요구 사항).

```bash
npm install
npm run dev         # 개발 서버 (기본 http://localhost:5173, /api/cards도 함께 동작)
npm run build       # 타입 검사 + 프로덕션 빌드
npm run lint        # 린트
npm run build:data  # 카드 데이터 다시 만들기 (data/, src/data/)
```

5173 포트가 이미 사용 중이면 Vite가 다른 포트를 자동으로 고릅니다. 터미널에 표시된 주소로 접속하세요.

## API

| 요청 | 설명 |
|---|---|
| `GET /api/cards?name=&type=&set=&rarity=&sort=&page=&pageSize=` | 검색 (`sort`: newest, oldest, name, number) |
| `GET /api/cards/:id` | 카드 상세 |
| `GET /api/cards/:id/neighbors` | 같은 세트의 이전/다음 카드 |
| `GET /api/cards/:id/related?limit=` | 같은 포켓몬(또는 같은 이름)의 다른 카드 |

## 폴더 구조

```
api/
└─ cards.ts      # Vercel Function 진입점
server/
└─ cardsApi.ts   # 카드 API (검색·상세·이전/다음·관련 카드). 개발 서버도 같은 코드 사용
scripts/
└─ build-data.mjs  # 카드 데이터 + 한국어 이름 생성
data/            # 생성된 카드 데이터 (index.json, cards/<세트>.json, sets.json, meta.json)
src/
├─ api/          # 카드 API 클라이언트 (재시도, 타임아웃, 캐시)
├─ components/   # Header, SearchBar, TypeFilter, CardTile, Pagination, 상태 화면, detail/(상세 섹션) 등 (CSS Modules)
├─ data/         # 필터용 세트·희귀도 목록 (생성됨)
├─ hooks/        # useCardSearch, useApiResource, useUrlParams, useMediaQuery, useDebouncedValue
├─ lib/          # 필터 ↔ URL ↔ API 파라미터 변환, 타입 이름·색상, 표시 문구
├─ pages/        # CardListPage, CardDetailPage(/cards/:id), NotFoundPage
├─ types/        # 카드 타입 정의
├─ App.tsx
├─ main.tsx
└─ index.css     # 전역 스타일, 색상 변수 (라이트/다크)
```

## 브랜치 전략

```
main        ← 기능이 모두 완성됐을 때 병합 (배포 기준)
 └ develop  ← 기능 통합 브랜치 (데모 자동 배포)
    └ feature/<기능명>  ← 기능 단위 작업
```

## 출처

- 카드 데이터: [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) (Pokémon TCG API의 원본 데이터)
- 한국어 포켓몬 이름: [PokéAPI](https://github.com/PokeAPI/pokeapi) (BSD-3-Clause)
- 카드 이미지: Pokémon TCG API 이미지 서버

Pokémon 및 관련 상표는 Nintendo, Creatures, GAME FREAK, The Pokémon Company의 자산이며, 이 프로젝트는 학습·포트폴리오 목적의 비공식 팬 프로젝트입니다.
