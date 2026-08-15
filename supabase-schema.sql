-- Ejecuta esto en Supabase: Panel → SQL Editor → New Query → pega y dale "Run"

create table licenses (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  business_name text,
  plan text default 'starter',

  max_text_per_month integer default 30,
  text_used_this_month integer default 0,

  max_images_per_month integer default 10,
  images_used_this_month integer default 0,

  max_videos_per_month integer default 5,
  videos_used_this_month integer default 0,

  active boolean default true,
  created_at timestamp default now()
);

-- Ejemplos de los 3 planes que definimos:

-- STARTER — $19/mes
insert into licenses (code, business_name, plan, max_text_per_month, max_images_per_month, max_videos_per_month)
values ('CLIENTE-STARTER-01', 'Nombre del cliente', 'starter', 30, 10, 5);

-- PRO — $39/mes
insert into licenses (code, business_name, plan, max_text_per_month, max_images_per_month, max_videos_per_month)
values ('CLIENTE-PRO-01', 'Nombre del cliente', 'pro', 100, 40, 20);

-- AGENCIA — $79/mes
insert into licenses (code, business_name, plan, max_text_per_month, max_images_per_month, max_videos_per_month)
values ('CLIENTE-AGENCIA-01', 'Nombre del cliente', 'agencia', 300, 120, 60);

-- Para reiniciar los 3 contadores de todos al empezar un mes nuevo:
-- update licenses set text_used_this_month = 0, images_used_this_month = 0, videos_used_this_month = 0;

-- Para desactivar a alguien que dejó de pagar:
-- update licenses set active = false where code = 'CODIGO_DEL_CLIENTE';
