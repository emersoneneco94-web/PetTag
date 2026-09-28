// POST /api/mercadopago/webhook
// Recebe as notificações do Mercado Pago (pagamento único E assinatura),
// SEMPRE reconsulta o recurso direto na API do Mercado Pago (nunca confia
// cegamente no corpo do webhook) e só então atualiza o Supabase.
//
// Configure esta URL em: Mercado Pago > Sua aplicação > Webhooks
//   https://SEU-DOMINIO/api/mercadopago/webhook
//
// Ao aprovar um pedido (tag_avulsa/tag_extra) ou ativar uma assinatura,
// gera automaticamente os códigos de TAG correspondentes na tabela `tags`
// (ativa=true, disponivel=true), prontos para o tutor vincular a um pet
// no painel, exatamente como já funciona hoje com `ativar_tag_pet`.

const crypto = require('crypto');
const { supabaseAdmin } = require('../_lib/supabaseAdmin');

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET; // opcional, recomendado

function gerarCodigoTag() {
  const bloco = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `STP-${bloco}`;
}

async function criarTags(qtd, extra) {
  // Nota: `tags` não tem coluna `disponivel` — ela é sempre calculada como
  // `pet_id is null` (ver função get_pet_public/verificar_tag_ativacao no
  // banco). Uma TAG recém-criada com pet_id nulo já nasce "disponível".
  const linhas = Array.from({ length: qtd }, () => ({
    codigo: gerarCodigoTag(),
    ativa: true,
    ...extra,
  }));
  try {
    await supabaseAdmin.insert('tags', linhas);
  } catch (err) {
    // Se a tabela `tags` tiver colunas diferentes das esperadas
    // (codigo/ativa/disponivel), o erro fica registrado no log da função
    // para ajuste manual — o pagamento em si já foi confirmado.
    console.error('Falha ao gerar códigos de TAG automaticamente:', err.details || err.message);
  }
}

// Validação opcional da assinatura do webhook (x-signature), conforme
// documentação do Mercado Pago. Se MERCADOPAGO_WEBHOOK_SECRET não estiver
// configurada, a validação é pulada (o passo de reconsultar o pagamento
// direto na API do MP abaixo já impede notificações forjadas).
function validarAssinatura(req) {
  if (!MP_WEBHOOK_SECRET) return true;

  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const dataId = req.query && (req.query['data.id'] || req.query.id);
  if (!signatureHeader || !requestId || !dataId) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.trim().split('='))
  );
  const ts = parts.ts;
  const hash = parts.v1;
  if (!ts || !hash) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');

  return hmac === hash;
}

module.exports = async (req, res) => {
  // Mercado Pago espera 200/201 rapidamente — sempre respondemos OK mesmo
  // em erros internos para evitar reentregas em loop; erros ficam nos logs.
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.status(405).end();
      return;
    }

    if (!validarAssinatura(req)) {
      console.warn('Webhook Mercado Pago: assinatura inválida, ignorando.');
      res.status(200).end();
      return;
    }

    const query = req.query || {};
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const topic = query.topic || query.type || body.type;
    const resourceId = query.id || query['data.id'] || (body.data && body.data.id);

    if (!resourceId) {
      res.status(200).end();
      return;
    }

    if (topic === 'payment') {
      await processarPagamento(resourceId);
    } else if (topic === 'preapproval' || topic === 'subscription_preapproval') {
      await processarAssinatura(resourceId);
    }

    res.status(200).end();
  } catch (err) {
    console.error('webhook error:', err);
    res.status(200).end(); // não deixar o MP reenviar infinitamente
  }
};

async function processarPagamento(paymentId) {
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return;
  const payment = await mpRes.json();

  const pedidoId = payment.external_reference;
  if (!pedidoId) return;

  const [pedido] = await supabaseAdmin.select('pedidos', `id=eq.${pedidoId}&select=*`);
  if (!pedido) return;

  let novoStatus = pedido.status;
  if (payment.status === 'approved') novoStatus = 'aprovado';
  else if (payment.status === 'rejected') novoStatus = 'rejeitado';
  else if (payment.status === 'cancelled') novoStatus = 'cancelado';
  else if (payment.status === 'refunded') novoStatus = 'estornado';

  const jaEstavaAprovado = pedido.status === 'aprovado';

  await supabaseAdmin.update('pedidos', `id=eq.${pedidoId}`, {
    status: novoStatus,
    mp_payment_id: String(payment.id),
    payload: payment,
    updated_at: new Date().toISOString(),
  });

  if (novoStatus === 'aprovado' && !jaEstavaAprovado) {
    await criarTags(pedido.quantidade_tags || 1, {
      pedido_id: pedido.id,
    });
  }
}

async function processarAssinatura(preapprovalId) {
  const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!mpRes.ok) return;
  const preapproval = await mpRes.json();

  const assinaturaId = preapproval.external_reference;
  if (!assinaturaId) return;

  const [assinatura] = await supabaseAdmin.select('assinaturas', `id=eq.${assinaturaId}&select=*`);
  if (!assinatura) return;

  let novoStatus = assinatura.status;
  if (preapproval.status === 'authorized') novoStatus = 'ativa';
  else if (preapproval.status === 'paused') novoStatus = 'pausada';
  else if (preapproval.status === 'cancelled') novoStatus = 'cancelada';

  const jaEstavaAtiva = assinatura.status === 'ativa';

  await supabaseAdmin.update('assinaturas', `id=eq.${assinaturaId}`, {
    status: novoStatus,
    payload: preapproval,
    updated_at: new Date().toISOString(),
  });

  if (novoStatus === 'ativa' && !jaEstavaAtiva) {
    await criarTags(assinatura.tags_incluidas || 1, {
      assinatura_id: assinatura.id,
    });
  }
}
