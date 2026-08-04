# MFDS 의약품 상세정보 대시보드

MFDS 의약품등 검색의 전체 목록을 페이지 단위로 불러오고, 제품을 선택하면 상세 페이지를 실시간으로 파싱해 보여주는 Vercel 배포용 대시보드입니다.

## 현재 구조

- `index.html`, `styles.css`, `app.js`: 검색/목록/상세/CSV 화면
- `api/search.js`: MFDS 검색 페이지를 호출해 총 건수와 현재 페이지 목록을 반환
- `api/detail.js`: `itemSeq`로 MFDS 상세 페이지를 호출해 기본정보, 성분표, 효능효과, 용법용량, 주의사항, DUR, 기타정보, 생산/수입실적을 반환
- `lib/mfds.js`: MFDS 목록/상세 공통 파서
- `scripts/local-server.mjs`: 로컬 미리보기 서버
- `scripts/scrape-mfds.mjs`: 전체 상세 데이터를 별도로 저장하고 싶을 때 쓰는 배치 수집 스크립트
- `db/schema.sql`: 95,000건 이상을 DB에 저장해 운영할 때 쓸 Postgres 스키마

## 로컬 확인

```bash
node scripts/local-server.mjs
```

그 다음 `http://localhost:4173`에서 확인합니다.

## Vercel 배포

이 폴더를 Vercel 프로젝트 루트로 배포하면 됩니다. 루트에 `index.html`, `vercel.json`, `api`, `lib`가 있어야 합니다.

## 전체 95,000건 처리 방식

목록은 MFDS 검색 페이지를 실시간으로 호출해 페이지 단위로 표시합니다. 그래서 95,000건 이상 전체를 한 번에 브라우저에 싣지 않고, 페이지 이동으로 전체 목록을 탐색합니다.

제품 상세는 사용자가 제품을 클릭할 때 `itemSeq` 기준으로 가져옵니다. 모든 제품의 상세 전문, DUR, 생산/수입실적까지 미리 저장하려면 아래처럼 배치 수집을 별도로 돌린 뒤 DB에 넣는 구성이 안정적입니다.

```bash
node scripts/scrape-mfds.mjs --pages 1-100 --concurrency 3 --delay 300 --out data/drugs-page-1-100.json
```

전체 결과 CSV는 상세 전문까지 포함하면 서버리스 요청 한 번으로 만들기 어렵습니다. 현재 화면의 CSV 버튼은 현재 페이지 목록을 내려받습니다. 전체 CSV나 전체 상세 CSV는 배치 수집 + DB/파일 export로 분리하는 것을 권장합니다.
