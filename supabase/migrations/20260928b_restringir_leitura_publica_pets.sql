-- Fecha vazamento de dados: a policy "Permitir leitura publica de pets"
-- liberava a LINHA INTEIRA da tabela `pets` (telefone, whatsapp, email,
-- alergias, medicamentos, lost_contact, tutor_id...) para qualquer pessoa
-- via REST, sem exigir login — bastava saber (ou adivinhar) o UUID de um pet.
--
-- Este arquivo já foi aplicado diretamente no projeto Supabase
-- (mqiwoubhivutavpnpeax) em 2026-09-28. Mantido aqui só para registro no
-- histórico do repositório — rodar de novo é seguro (idempotente).

-- Função SECURITY DEFINER que devolve só os campos que o perfil público
-- (public.html) realmente precisa mostrar. Busca por ID do pet (mesmo
-- parâmetro que a URL já usa hoje: public.html?pet=<uuid>), então nenhuma
-- TAG física já impressa precisa de um novo link.
create or replace function public.get_pet_public_by_id(p_pet_id uuid)
returns table (
  id uuid,
  nome text,
  especie text,
  raca text,
  peso numeric,
  cor text,
  foto_url text,
  observacoes text,
  cidade text,
  perdido boolean,
  data_perdido text,
  mensagem_perdido text,
  local_perdido text,
  recompensa text,
  tag_codigo text
)
language sql
security definer
set search_path to 'public'
stable
as $$
  select
    p.id,
    coalesce(p.nome, p.name)                                  as nome,
    coalesce(p.especie, p.species)                             as especie,
    coalesce(p.raca, p.breed)                                  as raca,
    p.weight                                                   as peso,
    p.color                                                    as cor,
    coalesce(p.foto_url, p.photo_url)                          as foto_url,
    p.observacoes                                              as observacoes,
    coalesce(p.cidade, p.city)                                 as cidade,
    (coalesce(p.perdido, false) or coalesce(p.is_lost, false)) as perdido,
    coalesce(p.lost_since::text, p.data_perdido::text)         as data_perdido,
    coalesce(p.lost_notes, p.mensagem_perdido)                 as mensagem_perdido,
    coalesce(p.last_scan_location, p.ultimo_local_perdido)     as local_perdido,
    p.lost_reward                                              as recompensa,
    coalesce(p.tag_code, (select t.codigo from public.tags t where t.pet_id = p.id limit 1)) as tag_codigo
  from public.pets p
  where p.id = p_pet_id
  limit 1;
$$;

-- Só quem tem o link (ou o RPC) consegue chamar — sem exigir login.
revoke all on function public.get_pet_public_by_id(uuid) from public;
grant execute on function public.get_pet_public_by_id(uuid) to anon, authenticated;

-- Remove o acesso de linha inteira e sem login que existia antes.
-- As policies "Tutor pode visualizar seus pets" / "tutor gerencia seus pets"
-- continuam intactas — o tutor logado continua vendo os próprios pets
-- normalmente no painel; isso só afeta acesso público/anônimo direto na tabela.
drop policy if exists "Permitir leitura publica de pets" on public.pets;
