# TOEFL 문제 생성 관리 시스템 (Admin Dashboard)

## 프로젝트 개요
TOEFL 13유형 문제를 AI(Claude/ChatGPT)로 자동 생성하고, Supabase DB에 등록 가능한 JSON으로 변환하는 관리자 전용 웹사이트

## 현재 상태: UI 목업 (기능 미구현)
4단계 전체 흐름이 보이는 UI/CSS만 완성된 상태입니다.

## 4단계 구조

### 1단계: 붙여넣기 → JSON 변환 (우선순위: 높음)
- 13유형 중 하나 선택
- 문제+해설 텍스트 붙여넣기
- Supabase용 JSON으로 자동 변환
- 복사/다운로드/Supabase 저장

### 2단계: AI 자동 생성 (우선순위: 중간)
- AI 모델 선택 (Claude / GPT-4)
- 유형 선택 + 생성 수량 지정
- 프롬프트 전송 → 결과 수신
- 생성 진행률 표시

### 3단계: 자동 검증 (우선순위: 중간)
- 유형별 검증 규칙 관리
- 필수 필드, 보기 개수, 정답 일치 등 검증
- Pass/Fail 자동 판별
- 검증 통계 대시보드

### 4단계: 프롬프트 편집 (우선순위: 낮음)
- 유형별 기본 프롬프트 편집
- 추가 규칙 동적 추가/삭제
- JSON 출력 형식 지정
- 최종 프롬프트 미리보기

## 13유형 목록
1. Fill in the Blanks
2. Daily 1
3. Daily 2
4. Academic
5. Response
6. Conversation
7. Announcement
8. Lecture
9. Arrange
10. Email
11. Discussion
12. Repeat
13. Interview

## 기술 스택
- Frontend: HTML/CSS/JS (정적 사이트)
- Backend: Vercel Serverless Functions (API 키 보호)
- Database: Supabase
- AI: Claude API / OpenAI API

## 파일 구조
```
index.html          - 메인 페이지 (전체 UI)
css/style.css       - 스타일시트
js/app.js           - 네비게이션 로직
README.md           - 프로젝트 문서
```

## 다음 구현 단계
1. **1단계 기능 구현** - Supabase 테이블 스키마 확인 후 JSON 변환 로직 구현
2. **2단계 기능 구현** - Vercel Serverless 함수 작성 + AI API 연동
3. **3단계 기능 구현** - 유형별 검증 규칙 JS 로직
4. **4단계 기능 구현** - 프롬프트 저장/불러오기 (localStorage 또는 Supabase)

## 필요한 정보 (구현 진행 시)
- [ ] Supabase 테이블 스키마 (컬럼명, 타입)
- [ ] 유형별 프롬프트 템플릿
- [ ] 유형별 JSON 출력 형식 예시
