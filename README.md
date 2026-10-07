# Pokémon Card Dex

포켓몬 트레이딩 카드 게임(TCG)의 카드 **20,635장**을 한국어·영어로 검색하고 상세 정보를 볼 수 있는 웹 카드 도감입니다.

**🔗 https://pokemon-card-dex-green.vercel.app**  ·  개발 버전(develop): [pokemon-card-dex-git-develop-dydqls-projects.vercel.app](https://pokemon-card-dex-git-develop-dydqls-projects.vercel.app)

<table>
  <tr>
    <td width="64%"><img src="docs/screenshots/list-desktop.webp" alt="카드 목록 (151 세트, 번호순)"></td>
    <td rowspan="2"><img src="docs/screenshots/search-mobile-dark.webp" alt="모바일 다크 모드에서 '피카츄' 한국어 검색"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/detail-desktop.webp" alt="카드 상세 (리자몽 ex)"></td>
  </tr>
</table>

## 주요 기능

- **한국어·영어 검색** — "리자몽", "메가 리자몽", "Charizard" 모두 검색. 띄어쓰기·대소문자·악센트(Flabébé) 무시
- **한국어 카드 이름** — 공식 한국어 포켓몬 이름으로 번역(포켓몬 카드 99.3%). 예) Charizard ex → 리자몽 ex, Misty's Gyarados → 이슬의 갸라도스. 트레이너스 카드는 게임 공식 아이템·장소명과 인물명 사전으로 번역(Rare Candy → 이상한사탕, Arven → 페퍼)
- **덱 빌더** — 카드를 골라 60장 덱 구성, 규칙 검사(60장, 같은 이름 4장, 기본 포켓몬, ACE SPEC·찬란한 포켓몬 1장, 스탠다드/익스팬디드 사용 가능 여부), Pokémon TCG Live 덱 목록 가져오기·내보내기, 링크로 공유. 로그인 없이 브라우저에 저장
- **필터와 정렬** — 타입·세트·희귀도 필터, 최신/오래된 세트순·이름순·번호순, 상태는 URL에 저장(새로고침·공유·뒤로 가기 유지)
- **카드 상세** — 큰 이미지 뷰어, 기술·특성(에너지 비용), 약점·저항력·후퇴, 세트 정보, 대회 사용 가능 여부, 같은 세트의 이전/다음 카드, 같은 포켓몬의 다른 카드
- **탐색 흐름 유지** — 상세에서 돌아오면 필터·페이지·스크롤 위치(모바일 "더 보기"로 쌓은 목록 포함) 복원
- **반응형·접근성** — 6열 → 2열 그리드, 다크 모드, 키보드 조작, 스크린 리더 레이블, Lighthouse 접근성·권장사항 100점

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프론트엔드 | React 19, TypeScript, Vite 8, React Router 7, CSS Modules |
| 서버 | Vercel Functions (`api/cards.ts`) |
| 데이터 | 자체 보유 카드 데이터([pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)) + 공식 한국어 이름([PokéAPI](https://github.com/PokeAPI/pokeapi)) |
| 이미지 | 자체 변환 WebP, GitHub Pages 호스팅 |
| 배포 | Vercel (`main` → 정식, `develop` → 개발 버전) |
| 도구 | Figma, oxlint, Chrome DevTools, Lighthouse, Notion |

## 구조

```
                      ┌─ scripts/build-data.mjs ───> data/          카드 20,635장 · 세트 176개 · 한국어 이름
  (빌드 시 한 번 생성) ─┤
                      └─ scripts/build-images.mjs ─> GitHub Pages   카드 이미지 WebP (245px · 440px)

  브라우저 ──> /api/cards  (Vercel Function, server/cardsApi.ts)    검색 · 상세 · 이전/다음 · 관련 카드
          └──> 카드 이미지  (GitHub Pages, 실패하면 원본 이미지로 대체)
```

- 외부 API를 실시간으로 호출하지 않습니다. 카드 데이터는 고정된 커밋에서 생성하고(`data/meta.json`), 서버 함수가 메모리에 올려 응답합니다(검색 수 ms, 응답은 엣지에 하루 캐시).
- 개발 서버(`npm run dev`)도 같은 서버 코드를 사용해 배포 환경과 동작이 같습니다.

## 문제 해결 기록

### 1. 절반이 실패하는 외부 API
처음에는 [Pokémon TCG API](https://pokemontcg.io)를 브라우저에서 직접 호출했지만, 요청의 절반가량이 500/502로 실패했습니다. 실패 응답에는 CORS 헤더도 없어 브라우저에서는 원인조차 보이지 않았습니다.
→ 클라이언트 재시도(지수 백오프)·타임아웃·캐시를 넣고, 이어서 같은 출처 프록시(Vercel Function)로 서버 쪽 재시도와 엣지 캐시를 도입해 브라우저 오류를 0건으로 만들었습니다.

### 2. 외부 API 종료 (2027-03-01)
이 API는 2027년 3월 1일 종료되고 후속 서비스는 유료였습니다.
→ API가 쓰던 공개 데이터를 직접 보유하고 자체 카드 API로 전환했습니다. 카드 이미지(원본 14GB)도 WebP로 변환해 직접 호스팅하고, 문제가 생기면 원본 이미지로 대체되게 했습니다. 외부 의존이 사라지면서 오류가 없어지고 검색이 빨라졌습니다.

### 3. 한국어 카드 이름 품질
도감 번호로 공식 한국어 이름을 붙였더니 "Erika's 뚜벅쵸"처럼 반만 번역된 이름이 703장 나왔습니다.
→ **이름 전체를 확신 있게 번역할 수 있을 때만 한국어, 아니면 영어**로 정책을 정하고, 트레이너 소유격(Erika's → 민화의)·폼(연격, 오리진 등) 사전과 TAG TEAM 분리 번역을 추가해 섞인 이름을 0건으로 만들었습니다.

### 4. 탐색 흐름이 끊기는 문제
페이지 이동 뒤 스크롤이 다시 아래로 끌려가는 문제(브라우저 스크롤 앵커링), 모바일에서 "더 보기"로 쌓은 목록이 상세에서 돌아오면 초기화되는 문제가 있었습니다.
→ 결과 영역의 `overflow-anchor`를 끄고 렌더 후 스크롤하도록 바꾸고, 쌓은 페이지 수를 history 항목별로 저장해 캐시에서 첫 화면에 그대로 다시 그리도록 했습니다.

## 개발 방식

[Claude Code](https://claude.com/claude-code) 세션 두 개로 역할을 나눠 개발했습니다.

| 세션 | 역할 |
|---|---|
| code | 기획 정리, Figma 디자인, 구현, 커밋·배포 |
| qa | 검증과 버그 리포트만 담당(코드는 수정하지 않음) — 실제 배포 URL과 브라우저 자동화로 레이아웃·라우팅·접근성·데이터 품질 확인 |

- 기능마다 **Figma 디자인 → `feature/*` 구현 → qa 검증 → 수정 → 재검증 → `develop` 병합** 순서로 진행했습니다.
- qa 리포트는 재현 방법·기대/실제 결과·파일 위치·심각도로 정리되고, 모든 지적을 해결한 뒤 재검증을 통과해야 병합합니다.
- 작업은 Notion 보드(상태별·표·간트)로 관리했습니다.

```
main        ← 기능이 모두 완성됐을 때 병합 (정식 배포)
 └ develop  ← 기능 통합 (데모 자동 배포)
    └ feature/<기능명>  ← 기능 단위 작업
```

## 시작하기

Node.js 20.19 이상 또는 22.12 이상이 필요합니다.

```bash
npm install
npm run dev          # 개발 서버 (기본 http://localhost:5173, /api/cards 포함)
npm run build        # sitemap 생성 + 타입 검사 + 프로덕션 빌드
npm run lint         # 린트
npm run build:data   # 카드 데이터 다시 생성 (data/, src/data/)
node scripts/build-images.mjs <출력 폴더>   # 카드 이미지 WebP 생성 (재실행하면 이어서 진행)
```

## API

| 요청 | 설명 |
|---|---|
| `GET /api/cards?name=&type=&set=&rarity=&supertype=&format=&sort=&page=&pageSize=` | 검색 (`sort`: newest, oldest, name, number / `supertype`: Pokémon, Trainer, Energy / `format`: standard, expanded / `pageSize` 최대 250) |
| `GET /api/cards/batch?ids=a,b,c` | 여러 카드를 한 번에 (최대 60개, 덱 빌더용) |
| `GET /api/cards/:id` | 카드 상세 |
| `GET /api/cards/:id/neighbors` | 같은 세트의 이전/다음 카드 |
| `GET /api/cards/:id/related?limit=` | 같은 포켓몬(또는 같은 이름)의 다른 카드 |

## 폴더 구조

```
api/cards.ts         Vercel Function 진입점
server/cardsApi.ts   카드 API (개발 서버와 공유)
scripts/             build-data.mjs(카드 데이터·한국어 이름), build-images.mjs(이미지)
data/                생성된 카드 데이터
docs/design/         디자인 시안
src/
├─ api/              카드 API 클라이언트 (재시도·타임아웃·캐시)
├─ components/       화면 구성 요소 (CSS Modules), detail/ 상세 섹션
├─ data/             필터용 세트·희귀도 목록 (생성됨)
├─ hooks/            useCardSearch, useApiResource, useUrlParams 등
├─ lib/              필터 ↔ URL ↔ API 변환, 표시 문구
├─ components/deck/  덱 빌더 (카드 선택, 덱 목록, 규칙 검사, 가져오기·내보내기)
├─ pages/            CardListPage, CardDetailPage, DeckListPage, DeckEditorPage, SharedDeckPage
├─ lib/deck.ts       덱 저장·규칙·PTCG Live 텍스트·공유 링크
└─ types/            카드 타입
```

## 로드맵

- [x] 카드 목록·검색·필터, 카드 상세, 배포
- [x] 자체 데이터·이미지 호스팅, 한국어 이름·검색
- [x] 정식 공개 v1.0.0 (`main`)
- [x] v1.0.1 첫 화면 속도, 링크 미리보기 이미지
- [ ] 트레이너스 카드 한국어 이름 확대 (공식 카드 검색과 대조 중)
- [ ] 덱 빌더 (M4, 개발 중)

## 출처

- 카드 데이터: [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)
- 한국어 포켓몬 이름: [PokéAPI](https://github.com/PokeAPI/pokeapi) (BSD-3-Clause)
- 카드 이미지: Pokémon TCG API 이미지를 변환해 호스팅

Pokémon 및 관련 상표·이미지의 권리는 Nintendo, Creatures, GAME FREAK, The Pokémon Company에 있으며, 이 프로젝트는 학습·포트폴리오 목적의 비공식 팬 프로젝트입니다.
