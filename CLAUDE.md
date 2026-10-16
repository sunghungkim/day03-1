# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 현황

우리 동네 숨은 맛집을 기록하고 동네 사람들과 함께 보는 한국어 웹앱입니다. 회원가입·로그인한 사람만 쓸 수 있고, 데이터는 Supabase(프로젝트 `day03-1`)에 있습니다. STEPS.md의 1~3단계와 추가 기능(댓글, 좋아요·싫어요, 날짜 표시, 로그인·관리자 모드)이 끝났고, 4단계(배포)가 남았습니다.

- `PRD.md`가 요구사항, 데이터 규칙, 권한, 완료 기준의 기준 문서입니다.
- `STEPS.md`는 처음 계획한 4단계(맛집 기록 → Supabase 저장 → AI 한줄평 → 배포)입니다. 그 뒤에 더한 기능은 PRD.md에만 있습니다.
- 두 문서는 한국어로 쓰여 있으므로 한국어로 유지합니다.
- PDF 4개(`Openrouter-메뉴얼`, `Supabase-메뉴얼`, `Vercel-매뉴얼`, `3일차-바이브코딩웹-연습`)는 수업 참고 자료입니다. 아직 읽지 않았습니다. 글자를 뽑으려면 이 PC에 없는 도구(Python, poppler)가 필요합니다.

## 빌드, 린트, 테스트

의도적으로 없습니다. 앱은 HTML·CSS·JS를 안에 담은 `index.html` 하나이고, npm이나 번들러, 빌드 과정을 쓰지 않습니다. `package.json`이나 빌드 파이프라인을 추가하지 마세요. Vercel은 저장소 루트를 정적 사이트로 서비스합니다.

`index.html`을 파일로 바로 열면 미리보기 창에서 localStorage가 막힙니다. 화면을 확인할 때는 `http://localhost`로 띄우세요.

## 구조

- **브라우저는 Edge Function `api` 하나에만 말합니다.** `index.html`에는 함수 주소만 있고 DB 키가 없습니다. 함수(`supabase/functions/api/index.ts`)가 세션 토큰을 확인한 뒤 `service_role`로 DB를 읽고 씁니다. 동작(action)은 `signup`, `login`, `logout`, `me`, `list`, `add_restaurant`, `delete_restaurant`, `add_comment`, `react`, `suggest_review`, `admin_members`, `admin_reset_password`입니다.
- **표에는 RLS 정책이 없습니다.** `anon`·`authenticated`에게 권한을 주지 않아서 `service_role`만 접근합니다. 표에 직접 접근하는 경로를 새로 열지 마세요. 권한 검사는 항상 함수에서 합니다.
- **로그인은 직접 만든 방식입니다.** Supabase Auth는 6자 미만 비밀번호를 받지 않아 4자리 관리자 비밀번호를 쓸 수 없어서입니다. 비밀번호는 DB 함수(`app_signup`, `app_login`, `app_set_password`, pgcrypto bcrypt)로만 다루고 원문은 어디에도 저장·표시하지 않습니다. 세션 토큰은 SHA-256 해시만 `sessions`에 저장합니다. 비밀번호를 관리자에게 보여 주는 기능은 만들지 않기로 했습니다.
- **표:** `restaurants`, `comments`, `reactions`(+ 뷰 `reaction_counts`), `members`, `sessions`. 글자 수·별점 제한은 화면, 함수, 표의 CHECK 제약 세 곳에서 막습니다. 세부 규칙은 PRD.md 7장입니다. `restaurants.member_id`는 작성자이고 `list`가 `author`(아이디)로 바꿔 내려보냅니다(예전 카드는 null). `comments`·`reactions`는 `restaurants`에 CASCADE로 묶여 카드를 지우면 함께 지워지고, `reactions`는 (`restaurant_id`, `member_id`)가 유일합니다.
- **관리자 계정(`0000`)은 마이그레이션이 아니라 SQL로 직접 넣었습니다.** 비밀번호가 저장소나 마이그레이션 기록에 남지 않게 하려는 것이니, 저장소에 넣지 마세요.
- **시연용 가상 데이터**(가상 회원 8명, 가상 카드 15개, 가상 위치·작성자)가 실제 DB에 있습니다. 새로 만든 데이터와 섞이니 지울 때 이름으로 확인하세요(PRD.md 14장).
- **AI 한줄평**은 `api`의 `suggest_review`가 `openrouter/free` 모델로 OpenRouter를 호출합니다. 결과는 한국어 한 문장, 40자 이내이며 한줄평 칸에만 채우고 자동 등록하지 않습니다.
- **비밀 값.** OpenRouter 키는 Supabase 프로젝트 Secrets의 `openrouter_api_key`에만 있고, 사용자가 대시보드에서 직접 넣습니다. 서비스 롤 키는 함수 안에서만 쓰고 화면·저장소에는 절대 넣지 않습니다.
- **함수 배포.** `supabase/functions/api/index.ts`를 고치면 Supabase에도 다시 배포해야 반영됩니다(`verify_jwt`는 끄고 배포). 옛 함수 `suggest-review`·`delete-restaurant`는 410만 돌려주는 빈 함수로 남아 있습니다.

## 디자인

NOL 디자인을 따릅니다(PRD.md 10장). 색은 `index.html` 맨 위 `:root`의 변수로 정리돼 있으니 값을 직접 쓰지 말고 변수를 쓰세요. 파란색은 버튼·선택·포커스에만 쓰고, 선택된 탭은 어두운 알약이며, 그림자는 쓰지 않습니다. 글꼴 Pretendard는 jsdelivr CDN에서 불러옵니다(빌드 없이 쓰기 위해).

목록은 정사각형 타일(`renderTile`, `.card`)이고, 전체 내용·반응·댓글·삭제는 눌렀을 때 열리는 `<dialog id="detailDialog">`(`renderDetail`)에 있습니다. `refresh()`가 열려 있는 창도 다시 그립니다. 한 페이지에 6개씩 나누는 것은 브라우저에서만 합니다(`PAGE_SIZE`, `renderList`, `renderPager`). 서버 `list`는 전부 내려보냅니다. 타일에 내용을 더 넣을 때는 정사각형이 깨지지 않게 줄 수를 제한하세요.

## 범위 밖

수정 기능, 사진 업로드, 검색, 회원 탈퇴·삭제, 이메일 인증, 소셜 로그인은 일부러 뺐습니다. 추가하지 마세요.

## 환경

- Windows와 PowerShell을 씁니다. Git은 이 저장소를 초기화한 뒤 winget으로 설치했습니다. 그 전에 열어 둔 터미널은 PATH에 Git이 없을 수 있고, 전체 경로는 `C:\Program Files\Git\cmd\git.exe`입니다.
- 푸시는 사용자의 GitHub 로그인이 필요해서 Bash/PowerShell 도구로는 안 되고, 터미널 패널(`run_in_terminal`)로 해야 합니다.
- PDF 4개는 커밋하지 않았습니다. GitHub 저장소에 둘지 `.gitignore`에 넣을지는 아직 정하지 않았습니다.
