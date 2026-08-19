-- 더박스 대타 보드 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하세요.

-- ── 스태프: 각자 본인 이름을 만들어 씁니다 (계정/비밀번호 없음) ──
create table if not exists public.staff (
  name       text primary key,
  created_at timestamptz not null default now()
);

-- ── 대타 요청: 근무표 없이 "이 날 못 나옴" 한 건이 한 행 ──
create table if not exists public.swap (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  requester  text not null references public.staff(name) on update cascade,
  cover      text          references public.staff(name) on update cascade,
  time_note  text,
  reason     text,
  tasks      jsonb not null default '[]'::jsonb,
  status     text  not null default 'open' check (status in ('open','filled','canceled')),
  created_at timestamptz not null default now(),
  filled_at  timestamptz
);

create index if not exists swap_date_idx      on public.swap(date);
create index if not exists swap_requester_idx on public.swap(requester);
create index if not exists swap_cover_idx     on public.swap(cover);

-- 같은 사람이 같은 날 중복 요청 못 올리게 (취소된 건은 제외)
create unique index if not exists swap_one_per_person_per_day
  on public.swap(date, requester) where status <> 'canceled';

-- 대타자는 요청자 본인일 수 없음
alter table public.swap drop constraint if exists swap_cover_not_self;
alter table public.swap add  constraint swap_cover_not_self check (cover is null or cover <> requester);

-- ── RLS ──
-- 스태프 6명이 URL을 공유해 쓰는 신뢰 기반 보드입니다.
-- anon 키로 읽기/쓰기를 모두 허용하되, 삭제는 막아 기록이 사라지지 않게 합니다.
-- (요청 철회는 status='canceled' 로 처리)
alter table public.staff enable row level security;
alter table public.swap  enable row level security;

drop policy if exists staff_read   on public.staff;
drop policy if exists staff_insert on public.staff;
create policy staff_read   on public.staff for select using (true);
create policy staff_insert on public.staff for insert with check (
  char_length(trim(name)) between 1 and 12
);

drop policy if exists swap_read   on public.swap;
drop policy if exists swap_insert on public.swap;
drop policy if exists swap_update on public.swap;
create policy swap_read   on public.swap for select using (true);
create policy swap_insert on public.swap for insert with check (status = 'open' and cover is null);
create policy swap_update on public.swap for update using (true) with check (true);

-- 참고: 지금은 로그인이 "이름 입력"뿐이라 서버가 본인 확인을 할 수 없습니다.
-- 남의 요청을 건드리는 걸 서버에서 막으려면 Supabase Auth(매직링크/비밀번호)를 붙이고
-- 위 update 정책을 auth.jwt() 기준으로 좁히면 됩니다.
