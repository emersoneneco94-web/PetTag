// POST /api/mercadopago/create-preference
// Cria uma cobrança ÚNICA (Checkout Pro) para: TAG avulsa ou TAG extra.
// Body esperado: { "produto": "tag_avulsa" | "tag_extra" }
// Header esperado: Authorization: Bearer <access_token do Supabase>
//
// Retorna { init_point } — a URL para redirecionar o navegador do tutor
// para o checkout hospedado do Mercado Pago (aceita Pix, boleto e cartão).

const { supabaseAdmin } = require('../_lib/supabaseAdmin');
const { getTutorFromRequest } = require('../_lib/auth');
const { PRODUTOS_AVULSOS } = require('../_lib/plans');

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL || 'https://www.savetagpet.com.br';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    if (!MP_ACCESS_TOKEN) {
      throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN nas variáveis de ambiente.');
    }

    const tutor = await getTutorFromRequest(req);
    if (!tutor) {
      res.status(401).json({ error: 'Faça login antes de continuar a compra.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const produtoKey = body.produto;
    const produto = PRODUTOS_AVULSOS[produtoKey];

    if (!produto) {
      res.status(400).json({ error: 'Produto inválido.' });
      return;
    }

    // 1) cria o pedido como "pendente" — o preço vem SEMPRE do catálogo do servidor
    const [pedido] = await supabaseAdmin.insert('pedidos', [
      {
        tutor_id: tutor.id,
        tipo: produtoKey,
        quantidade_tags: produto.tags,
        valor_centavos: Math.round(produto.valor * 100),
        status: 'pendente',
      },
    ]);

    // 2) cria a preferência no Mercado Pago (Checkout Pro)
    const preference = {
      items: [
        {
          title: produto.nome,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: produto.valor,
        },
      ],
      payer: { email: tutor.email },
      external_reference: pedido.id,
      notification_url: `${SITE_URL}/api/mercadopago/webhook`,
      back_urls: {
        success: `${SITE_URL}/painel.html?compra=sucesso`,
        pending: `${SITE_URL}/painel.html?compra=pendente`,
        failure: `${SITE_URL}/painel.html?compra=erro`,
      },
      auto_return: 'approved',
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      await supabaseAdmin.update('pedidos', `id=eq.${pedido.id}`, {
        status: 'rejeitado',
        payload: mpData,
      });
      throw new Error(`Mercado Pago recusou a preferência: ${JSON.stringify(mpData)}`);
    }

    await supabaseAdmin.update('pedidos', `id=eq.${pedido.id}`, {
      mp_preference_id: mpData.id,
      payload: mpData,
    });

    res.status(200).json({ init_point: mpData.init_point, pedido_id: pedido.id });
  } catch (err) {
    console.error('create-preference error:', err);
    res.status(500).json({ error: 'Não foi possível iniciar o pagamento. Tente novamente em instantes.' });
  }
};
