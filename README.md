# Pokémon Card Dex

포켓몬 트레이딩 카드 게임(TCG)의 카드를 검색하고, 필터링하고, 상세 정보를 볼 수 있는 웹 도감입니다.
이후 덱 빌더 기능으로 확장할 예정입니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프레임워크 | React 19 + TypeScript |
| 빌드 도구 | Vite |
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
- [ ] 카드 상세 페이지
- [ ] 배포 (Vercel)
- [ ] 덱 빌더

## 주요 기능

- **검색과 필터**: 카드 이름(영문) 부분 검색, 타입·세트·희귀도 필터, 4가지 정렬
  - API가 거부하는 문자(한글, " ( 등)는 요청 전에 걸러내고, 한글 검색에는 영문 검색 안내를 표시
- **URL 상태**: 검색어·필터·페이지가 주소에 저장되어 새로고침, 링크 공유, 뒤로 가기가 그대로 동작
- **불안정한 API 대응**: 요청의 상당수가 500/502로 실패하는 API라 다음을 적용
  - 일시적 오류는 최대 4회 재시도(지수 백오프), 요청 전체 마감 시간 25초
  - 성공한 응답은 10분간 메모리에 캐시
  - 세트·희귀도 목록은 앱에 스냅샷(src/data)을 포함해 API가 멈춰도 필터가 동작하고, 최신 목록은 백그라운드로 받아 하루 동안 localStorage에 캐시
  - 5초 이상 걸리면 "응답이 늦어지고 있어요" 안내, 최종 실패 시 다시 시도 버튼
  - 검색어나 필터가 바뀌면 이전 요청은 즉시 취소(AbortController)
- **반응형**: 6열 → 2열 그리드, 모바일에서는 필터 패널과 "더 보기" 방식
- **접근성**: 키보드 조작, `aria-pressed`/`aria-current`, 스크린 리더용 결과 수 알림, 움직임 줄이기 설정 존중

## 디자인

[Figma: Pokémon Card Dex](https://www.figma.com/design/n7tkM2aFBRJs43Qe9fNIwS) — 데스크톱, 모바일, 목록 상태(로딩·결과 없음·오류) 화면

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
[dev.pokemontcg.io](https://dev.pokemontcg.io)에서 무료로 발급받은 뒤 `.env.example`을 `.env.local`로 복사해 값을 채우세요.

```
VITE_POKEMON_TCG_API_KEY=발급받은_키
```

## 폴더 구조

```
src/
├─ api/          # Pokémon TCG API 클라이언트 (재시도, 타임아웃, 캐시)
├─ components/   # Header, SearchBar, TypeFilter, CardTile, Pagination, 상태 화면 등 (CSS Modules)
├─ hooks/        # useCardSearch, useFilterOptions, useUrlParams, useMediaQuery, useDebouncedValue
├─ lib/          # 필터 ↔ URL ↔ API 쿼리 변환, 타입 이름·색상, 페이지 번호 계산
├─ pages/        # CardListPage
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
