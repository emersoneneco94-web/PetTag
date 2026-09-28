# Configuração: Pagamento (Mercado Pago) + Alerta automático de WhatsApp

Este guia mostra exatamente o que fazer, na ordem certa, para deixar as duas
novidades funcionando em produção:

1. Pagamento (TAG avulsa + assinaturas Save Tag / Save Tag Família) via Mercado Pago.
2. Alerta automático de WhatsApp para o tutor quando alguém escaneia o QR de um pet
   marcado como "perdido" e toca em "Encontrei o pet".

Nada disso funciona sozinho: são 4 passos — banco de dados, Mercado Pago, Meta
WhatsApp Cloud API e variáveis de ambiente na Vercel.

---

## 1) Banco de dados (Supabase)

1. Acesse o [painel do Supabase](https://supabase.com/dashboard) → projeto `mqiwoubhivutavpnpeax`.
2. Vá em **SQL Editor** → **New query**.
3. Abra o arquivo [`supabase/migrations/20260928_payments_whatsapp.sql`](../supabase/migrations/20260928_payments_whatsapp.sql)
   deste repositório, copie todo o conteúdo, cole no editor e clique **Run**.
4. Confira em **Table Editor** se as tabelas `pedidos` e `assinaturas` foram
   criadas, e se `tag_leituras` ganhou 3 colunas novas (`whatsapp_enviado`,
   `whatsapp_erro`, `meta_message_id`).

Conferi direto no seu banco (projeto `mqiwoubhivutavpnpeax`) antes de
escrever o código, então tudo abaixo já usa os nomes reais das suas tabelas:

- `tags.disponivel` não existe como coluna — é sempre calculado como
  `pet_id is null` (é assim que `get_pet_public` e `verificar_tag_ativacao`
  já fazem). O webhook do Mercado Pago só grava `codigo` e `ativa`.
- `tutores.telefone` é o campo com o telefone do tutor (não existe
  `whatsapp` separado nessa tabela).
- Já existe uma tabela `tag_leituras`, com RPCs prontas
  (`registrar_leitura_tag`, `registrar_localizacao_leitura`) claramente
  pensadas para logar quando alguém lê a TAG de um pet perdido. Em vez de
  criar uma tabela paralela, o alerta de WhatsApp grava o resultado do envio
  ali mesmo, reaproveitando essa estrutura.

Você também vai precisar da **Service Role Key** do Supabase (não é a mesma
chave pública que já está no código): **Project Settings → API → service_role
secret**. Guarde para o passo 4 — ela dá acesso total ao banco, nunca a
exponha no frontend.

---

## 2) Mercado Pago

1. Crie/acesse sua conta em [mercadopago.com.br](https://www.mercadopago.com.br).
2. Vá em **Seu negócio → Configurações → Credenciais de produção**
   (`https://www.mercadopago.com.br/developers/panel/app`).
3. Crie uma aplicação (qualquer nome, ex. "Save Tag Pet").
4. Copie o **Access Token de produção** (começa com `APP_USR-...`).
   Guarde para o passo 4.
5. Ainda no painel da aplicação, vá em **Webhooks** e cadastre a URL:
   ```
   https://www.savetagpet.com.br/api/mercadopago/webhook
   ```
   Eventos: marque **Pagamentos** e **Assinaturas (preapproval)**.
6. Copie a **Assinatura secreta (webhook secret)** gerada — vai na variável
   `MERCADOPAGO_WEBHOOK_SECRET` (opcional, mas recomendado; sem ela o sistema
   ainda funciona, só perde uma camada extra de verificação).

**Preços cobrados hoje** (definidos em `api/_lib/plans.js`, iguais ao que já
está em `index.html#planos`):

| Item | Tipo | Valor |
|---|---|---|
| TAG Avulsa | pagamento único | R$ 49,90 |
| TAG extra | pagamento único | R$ 29,90 *(preço que eu sugeri — não estava no site, confirme comigo se é esse valor mesmo)* |
| Plano Save Tag | assinatura mensal | R$ 9,90/mês |
| Plano Save Tag Família | assinatura mensal | R$ 19,90/mês |

Se algum valor mudar, edite só o arquivo `api/_lib/plans.js` — é a fonte
única de verdade dos preços no servidor (o preço nunca vem do navegador do
cliente, por segurança).

---

## 3) Meta WhatsApp Cloud API

1. Crie uma conta em [business.facebook.com](https://business.facebook.com) (Meta Business Suite), se ainda não tiver.
2. Vá em [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar app** → tipo **Empresa** → adicione o produto **WhatsApp**.
3. No painel do produto WhatsApp → **Introdução**, você já recebe um número de teste. Para produção, em **Configuração da API** conecte/verifique o número de telefone real que vai enviar os alertas (pode ser um número novo, só para isso).
4. Anote:
   - **Phone number ID** (em Configuração da API) → variável `WHATSAPP_PHONE_NUMBER_ID`.
   - **Token de acesso permanente**: em **Configurações do sistema → Usuários do sistema**, crie um usuário do sistema, gere um token permanente com a permissão `whatsapp_business_messaging` → variável `WHATSAPP_CLOUD_API_TOKEN`.
5. **Crie o template de mensagem** (obrigatório — o WhatsApp exige um template
   aprovado para o primeiro contato automático, já que o tutor não iniciou a
   conversa): vá em **Gerenciador do WhatsApp → Modelos de mensagem → Criar modelo**.
   - Nome: `pet_encontrado` (mesmo nome da variável `WHATSAPP_TEMPLATE_NAME`, caso troque o nome, atualize a env var também)
   - Categoria: **Utilidade**
   - Idioma: **Português (BR)**
   - Corpo da mensagem, com 2 variáveis:
     ```
     🚨 Boa notícia! Alguém escaneou a TAG do(a) {{1}} e sinalizou que encontrou seu pet.
     Localização informada: {{2}}
     Entre em contato o quanto antes.
     ```
   - Envie para aprovação (normalmente leva de minutos a poucas horas).

> Sem o template aprovado, o envio automático falha silenciosamente (fica
> registrado como `erro` na tabela `whatsapp_alertas`) — o botão "Encontrou
> meu pet?" continua funcionando do jeito antigo (abre o WhatsApp de quem
> encontrou) como plano B, então o site nunca fica sem esse canal.

---

## 4) Variáveis de ambiente na Vercel

Vá em **Vercel → projeto save-tag-pet → Settings → Environment Variables** e
adicione (ambiente **Production** — e Preview, se for testar antes):

| Nome | De onde vem |
|---|---|
| `SUPABASE_URL` | `https://mqiwoubhivutavpnpeax.supabase.co` |
| `SUPABASE_ANON_KEY` | a mesma chave pública já usada no HTML (`sb_publishable_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** (passo 1) |
| `MERCADOPAGO_ACCESS_TOKEN` | Mercado Pago → Credenciais de produção (passo 2) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Mercado Pago → assinatura do webhook (passo 2, opcional) |
| `WHATSAPP_CLOUD_API_TOKEN` | Meta → token permanente do usuário do sistema (passo 3) |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → Configuração da API (passo 3) |
| `WHATSAPP_TEMPLATE_NAME` | `pet_encontrado` (ou o nome que você usou) |
| `WHATSAPP_TEMPLATE_LANG` | `pt_BR` |
| `SITE_URL` | `https://www.savetagpet.com.br` |

Depois de adicionar todas, faça um **redeploy** do projeto (Vercel só lê
variáveis de ambiente novas em builds novos).

---

## 5) Testando

- **Pagamento**: use as [credenciais de teste do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/test/cards)
  antes de trocar para produção, se quiser testar sem gastar dinheiro de verdade.
- **WhatsApp**: no painel do tutor, marque um pet como "perdido", abra o perfil
  público dele (`public.html?pet=ID_DO_PET`) em outro navegador/celular, toque
  em "Encontrou meu pet?" e confira se a mensagem chega no WhatsApp cadastrado.
  Os resultados de cada tentativa ficam gravados na tabela `tag_leituras`
  no Supabase (coluna `origem = 'whatsapp_alert'`), útil para depurar.

---

## Observações importantes que encontrei no código/banco atual

- Hoje, o botão "Encontrou meu pet?" em `public.html` sempre manda a mensagem
  para o número **fixo** `5513991118997` (o seu, hardcoded), não para o
  telefone real de cada tutor — provavelmente um placeholder deixado durante o
  desenvolvimento. Eu mantive esse botão como está (ele ainda funciona como
  canal manual extra), mas o **novo alerta automático já busca o telefone
  real** na seguinte ordem: `pets.lost_contact` (contato de emergência
  cadastrado ao marcar o pet como perdido) → `pets.whatsapp`/`pets.phone` →
  `tutores.telefone` (mesma fonte que a função `get_pet_public` já usa).
  Se quiser, no futuro também dá pra corrigir o botão wa.me antigo para usar
  o telefone real — é só avisar.
- O banco já tinha uma tabela `tag_leituras` e três funções
  (`registrar_leitura_tag`, `registrar_localizacao_leitura`, `get_pet_public`)
  claramente feitas para um fluxo de "ler TAG → logar leitura → tutor vê no
  painel", mas `public.html` nunca chegou a usar essas funções (ele lê a
  tabela `pets` direto, por `id`, via REST). Não mexi nesse comportamento
  para não arriscar quebrar o que já está no ar — só fiz o alerta de
  WhatsApp reaproveitar a tabela `tag_leituras` para o log. Se no futuro
  quiser migrar `public.html` para usar `get_pet_public`/`registrar_leitura_tag`
  de verdade (o que também destravaria histórico de leituras por localização
  no painel), posso montar isso depois.
- Também notei uma função `fn_login_by_tag` no banco que parece quebrada
  (referencia uma tabela `tutors` que não existe — o certo é `tutores`) e não
  é chamada por nenhum HTML atual. Não mexi nela, só deixo registrado.
- Os botões "Quero adquirir uma TAG" do topo e do rodapé de `index.html`
  continuam abrindo o WhatsApp manual (não mexi neles) — só os 3 botões
  dentro da seção **#planos** (TAG Avulsa, Save Tag, Save Tag Família) agora
  abrem o checkout do Mercado Pago. Se quiser que todos os pontos de venda
  usem o checkout automático, me avise.
- A tabela `pets` hoje tem uma policy `SELECT` pública (`Permitir leitura
  publica de pets`) que libera **todas** as colunas para qualquer pessoa via
  REST — inclusive `phone`, `whatsapp`, `alergias`, `medicamentos` etc., que
  não deveriam ficar públicas. Isso é anterior a mim e não fazia parte do que
  você pediu, mas como mexe diretamente com privacidade dos seus usuários,
  vale eu corrigir isso também? Se sim, o ajuste é trocar essa policy por uma
  baseada na função `get_pet_public` (que já filtra os campos certos).
