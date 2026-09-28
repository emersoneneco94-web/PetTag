-- =====================================================================
-- Save Tag Pet — Pagamentos (Mercado Pago) + Alertas automáticos de WhatsApp
-- =====================================================================
-- Como rodar: Supabase Dashboard → SQL Editor → cole este arquivo inteiro → Run.
-- É seguro rodar mais de uma vez (todas as instruções usam IF NOT EXISTS/OR REPLACE).
--
-- Conferido direto no schema real do projeto (mqiwoubhivutavpnpeax) em 2026-09-28:
-- `tags` NÃO tem coluna `disponivel` (é calculada como `pet_id is null`),
-- `tutores` tem `telefone` (não `whatsapp`), e já existe a tabela
-- `tag_leituras` com as colunas certas para logar o disparo do alerta —
-- por isso, em vez de criar uma tabela nova de log, só adicionamos 3
-- colunas nela.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) PEDIDOS — pagamento único (TAG avulsa / TAG extra)
-- ---------------------------------------------------------------------
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid references auth.users(id) on delete set null,
  tipo text not null check (tipo in ('tag_avulsa','tag_extra')),
  quantidade_tags integer not null default 1,
  valor_centavos integer not null,
  status text not null default 'pendente'
    check (status in ('pendente','aprovado','rejeitado','cancelado','estornado')),
  mp_preference_id text,
  mp_payment_id text,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_tutor_idx on public.pedidos (tutor_id);
create index if not exists pedidos_mp_preference_idx on public.pedidos (mp_preference_id);
create index if not exists pedidos_mp_payment_idx on public.pedidos (mp_payment_id);

-- ---------------------------------------------------------------------
-- 2) ASSINATURAS — planos recorrentes (Save Tag / Save Tag Família)
-- ---------------------------------------------------------------------
create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid references auth.users(id) on delete set null,
  plano text not null check (plano in ('save_tag','save_tag_familia')),
  status text not null default 'pendente'
    check (status in ('pendente','ativa','pausada','cancelada','inadimplente')),
  max_pets integer not null,
  tags_incluidas integer not null,
  valor_centavos integer not null,
  mp_preapproval_id text unique,
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assinaturas_tutor_idx on public.assinaturas (tutor_id);

-- Garante no máximo 1 assinatura ATIVA por tutor (histórico de canceladas fica preservado)
create unique index if not exists assinaturas_tutor_ativa_uidx
  on public.assinaturas (tutor_id)
  where status = 'ativa';

alter table public.pedidos enable row level security;
alter table public.assinaturas enable row level security;

drop policy if exists "tutor le seus pedidos" on public.pedidos;
create policy "tutor le seus pedidos" on public.pedidos
  for select using (auth.uid() = tutor_id);

drop policy if exists "tutor le suas assinaturas" on public.assinaturas;
create policy "tutor le suas assinaturas" on public.assinaturas
  for select using (auth.uid() = tutor_id);

-- ---------------------------------------------------------------------
-- 3) Rastreio de origem das TAGs geradas por um pagamento
-- ---------------------------------------------------------------------
alter table public.tags add column if not exists pedido_id uuid references public.pedidos(id) on delete set null;
alter table public.tags add column if not exists assinatura_id uuid references public.assinaturas(id) on delete set null;

-- ---------------------------------------------------------------------
-- 4) Log do disparo automático de WhatsApp — reaproveita `tag_leituras`
--    (já existe e já é alimentada por registrar_leitura_tag / RLS pronta),
--    só adiciona as 3 colunas para saber se o alerta foi enviado.
-- ---------------------------------------------------------------------
alter table public.tag_leituras add column if not exists whatsapp_enviado boolean;
alter table public.tag_leituras add column if not exists whatsapp_erro text;
alter table public.tag_leituras add column if not exists meta_message_id text;

-- ---------------------------------------------------------------------
-- Fim. Depois de rodar, confira em Table Editor se `pedidos` e
-- `assinaturas` foram criadas, e se `tag_leituras` ganhou as 3 colunas novas.
-- ---------------------------------------------------------------------
