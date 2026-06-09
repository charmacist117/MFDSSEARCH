# MFDS 의약품 상세정보 대시보드

MFDS 의약품등 검색 목록에서 `itemSeq`를 모으고, 제품 상세 페이지의 기본정보, 원료약품 및 분량, 첨가제, 효능효과, 용법용량, 사용상의 주의사항, DUR, 재심사/RMP/보험/기타정보, 생산/수입실적을 저장해서 검색 화면에 띄우는 Vercel 배포용 구조입니다.

## 구성

- `index.html`, `styles.css`, `app.js`: 대시보드 화면
- `data/drugs.sample.json`: 참콜드, 프롤리아, 엔블로 샘플 데이터
- `scripts/scrape-mfds.mjs`: MFDS 목록/상세 수집 스크립트
- `api/search.js`, `api/detail.js`: Vercel 서버리스 조회 API
- `db/schema.sql`: 전체 9만 건 이상 운영 시 Postgres로 옮길 때 쓸 기본 스키마

## 로컬 확인

```bash
node scripts/local-server.mjs
```

그 다음 `http://localhost:4173`에서 확인합니다.

## 샘플 상세 재수집

```bash
node scripts/scrape-mfds.mjs --itemSeq 202601126,201404452,202204314 --out data/drugs.sample.json
```

## 목록에서 상세까지 수집

```bash
node scripts/scrape-mfds.mjs --pages 1-5 --concurrency 3 --delay 300 --out data/drugs.json
```

전체를 한 번에 빠르게 긁기보다 페이지 범위와 지연시간을 두고 나누는 편이 안정적입니다. MFDS 목록의 제품명 링크는 `getItemDetail?itemSeq=...` 형태라서, 상세 캐시 URL의 날짜가 바뀌어도 최신 캐시 페이지로 따라갑니다.

## Vercel 배포

이 폴더를 Vercel 프로젝트 루트로 배포하면 정적 화면과 `/api/search`, `/api/detail` 함수가 같이 올라갑니다.

대량 운영에서는 `data/drugs.json` 파일 하나에 모든 상세 전문을 넣기보다, `db/schema.sql` 기준으로 Supabase, Neon, Vercel Postgres 같은 DB에 넣는 구성이 좋습니다. 상세 전문과 주의사항이 길어서 95,000건 전체를 JSON 번들로 싣는 방식은 배포 용량과 함수 메모리에 부담이 생길 수 있습니다.
