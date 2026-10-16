# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 현황

아직 문서만 있고 코드는 없습니다. 우리 동네 숨은 맛집을 기록하고 동네 사람들과 함께 보는 한국어 웹앱을 만들 예정입니다.

- `PRD.md`가 요구사항, 데이터 규칙, 권한, 완료 기준의 기준 문서입니다.
- `STEPS.md`가 만드는 순서입니다: 맛집 기록(localStorage) → Supabase 저장 → AI 한줄평 → 배포. 한 단계를 끝내고 확인한 뒤 다음 단계로 가고, 단계마다 커밋합니다.
- 두 문서는 한국어로 쓰여 있으므로 한국어로 유지합니다.
- PDF 4개(`Openrouter-메뉴얼`, `Supabase-메뉴얼`, `Vercel-매뉴얼`, `3일차-바이브코딩웹-연습`)는 수업 참고 자료입니다. 아직 읽지 않았습니다. 글자를 뽑으려면 이 PC에 없는 도구(Python, poppler)가 필요합니다.

## 빌드, 린트, 테스트

의도적으로 없습니다. 앱은 HTML·CSS·JS를 안에 담은 `index.html` 하나이고, npm이나 번들러, 빌드 과정을 쓰지 않습니다. `package.json`이나 빌드 파이프라인을 추가하지 마세요. Vercel은 저장소 루트를 정적 사이트로 서비스합니다.

## 구조

- **한 페이지, 한 파일.** 위에 입력 폼, 아래에 맛집 카드 목록이 있고, 새 기록이 맨 위에 옵니다(`created_at` 내림차순).
- **저장소는 겹치지 않고 교체합니다.** 1단계는 localStorage를 쓰고, 2단계에서 Supabase로 바꿉니다. 두 곳의 필드 이름(`name`, `menu`, `rating`, `review`, `created_at`)을 같게 유지해, 교체할 때 불러오기·저장·삭제 함수만 고치면 되게 합니다.
- **Supabase 표 `restaurants`**는 새로 만들고 기존 표는 건드리지 않습니다. 글자 수·별점 제한은 폼과 표의 CHECK 제약 양쪽에서 막습니다. 세부 규칙은 PRD.md 7.2를 따릅니다.
- **RLS를 켜고 조회·추가·삭제 정책만 둡니다.** 수정은 범위 밖이라 수정 정책이 없는 것은 의도한 것입니다. 접근은 로그인 없이 익명으로 합니다.
- **AI 한줄평은 Supabase Edge Function 1개를 거칩니다.** `verify_jwt`는 꺼 둡니다(로그인이 없어서 의도한 것입니다). 브라우저는 이 함수만 호출하고, 함수가 `openrouter/free` 모델로 OpenRouter를 호출합니다. 결과는 한국어 한 문장, 40자 이내이며 한줄평 칸에 채워집니다. 자동으로 등록하지 않습니다. 함수는 입력 길이와 별점을 검사하고 CORS를 처리합니다.
- **비밀 값.** OpenRouter 키는 Supabase 프로젝트 Secrets에 `openrouter_api_key`로만 두고, 사용자가 Supabase 대시보드에서 직접 넣습니다. `index.html`에는 Supabase URL과 공개용(anon/publishable) 키만 둘 수 있고, 서비스 롤 키는 절대 넣지 않습니다.

## 범위 밖

로그인, 수정, 사진 업로드, 검색은 일부러 뺐습니다. 추가하지 마세요.

## 환경

- Windows와 PowerShell을 씁니다. Git은 이 저장소를 초기화한 뒤 winget으로 설치했습니다. 그 전에 열어 둔 터미널은 PATH에 Git이 없을 수 있고, 전체 경로는 `C:\Program Files\Git\cmd\git.exe`입니다.
- 첫 푸시 전에 PDF 4개를 GitHub 저장소에 둘지 `.gitignore`에 넣을지 정하세요(STEPS.md 4단계).
