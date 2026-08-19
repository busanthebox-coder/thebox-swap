/* 구글 시트 백엔드 주소.
   비워두면 "로컬 모드"로 동작합니다 — 내 기기에만 저장되고 다른 사람에게는 안 보입니다.

   채우는 법 (한 번만 하면 됩니다):
   1) 쓸 구글 시트를 엽니다 (데이터는 "대타" 탭에 쌓입니다)
   2) 확장 프로그램 → Apps Script → apps-script/Code.gs 내용을 전부 붙여넣고 저장
   3) 배포 → 새 배포 → 유형 "웹 앱"
        실행 계정: 나
        액세스 권한: 모든 사용자     ← 이게 중요합니다 (스태프가 구글 로그인 없이 쓰게)
   4) 배포 → 승인 → 나온 "웹 앱 URL"(.../exec 로 끝남)을 아래에 붙여넣습니다

   이 URL은 비밀번호가 아니라 주소일 뿐입니다. 공개돼도 계정이 털리지 않습니다.
   다만 주소를 아는 사람은 글을 쓸 수 있으니, 스태프끼리만 공유하세요. */
window.THEBOX_CONFIG = {
  GAS_URL: "https://script.google.com/macros/s/AKfycbzHqgV33sJLJUjDNtDUyBD0C5fdbqrnJvRHwQLHla179qqANgO_-ZhPnBLEAPqjS6Fc/exec"
};
