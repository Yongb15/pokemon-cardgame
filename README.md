# Pokémon Card Dex

포켓몬 트레이딩 카드 게임(TCG)의 카드를 검색하고, 필터링하고, 상세 정보를 볼 수 있는 웹 도감입니다.
이후 덱 빌더 기능으로 확장할 예정입니다.

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프레임워크 | React 19 + TypeScript |
| 빌드 도구 | Vite |
| 린트 | oxlint |
| 데이터 | [Pokémon TCG API v2](https://docs.pokemontcg.io/) |

## 진행 상황

- [x] 프로젝트 초기 세팅 (Vite + React + TypeScript, API 클라이언트, 카드 타입 정의)
- [ ] 카드 목록 + 페이지네이션
- [ ] 이름 검색
- [ ] 필터 (타입, 세트, 희귀도)
- [ ] 카드 상세 페이지
- [ ] 반응형 레이아웃 / 다크 모드 정리
- [ ] 배포 (Vercel)
- [ ] 덱 빌더

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
├─ api/        # Pokémon TCG API 요청 함수
├─ types/      # API 응답 타입 정의
├─ App.tsx
├─ main.tsx
└─ index.css   # 전역 스타일, 색상 변수 (라이트/다크)
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
