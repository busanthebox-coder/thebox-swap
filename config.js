/* Supabase 연결 정보.
   비워두면 "로컬 모드"로 동작합니다 — 내 기기에만 저장되고 다른 사람에게는 안 보입니다.

   채우는 법:
   1) supabase.com 무료 가입 → New project
   2) Project Settings → Data API 에서 두 값 복사
   3) 아래 두 줄에 붙여넣고 커밋 → 자동 배포

   anon key는 공개되어도 되는 키입니다 (브라우저에 노출되는 게 정상).
   실제 접근 제어는 supabase/schema.sql 의 RLS 정책이 담당합니다. */
window.THEBOX_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
