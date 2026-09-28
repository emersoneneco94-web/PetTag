// POST /api/mercadopago/create-subscription
// Cria uma assinatura RECORRENTE (Mercado Pago "preapproval") para os
// planos Save Tag / Save Tag Família.
// Body esperado: { "plano": "save_tag" | "save_tag_familia" }
// Header esperado: Authorization: Bearer <access_token do Supabase>
//
// Retorna { init_point } — URL de checkout do Mercado Pago onde o tutor
// autoriza a cobrança recorrente (cartão de crédito).

const { supabaseAdmin } = require('../_lib/supabaseAdmin');
const { getTutorFromRequest } = require('../_lib/auth');
const { PLANOS_RECORRENTES } = require('../_lib/plans');

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
      res.status(401).json({ error: 'Faça login antes de assinar um plano.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const planoKey = body.plano;
    const plano = PLANOS_RECORRENTES[planoKey];

    if (!plano) {
      res.status(400).json({ error: 'Plano inválido.' });
      return;
    }

    // Impede assinatura duplicada: se já existir uma "ativa" ou "pendente", reaproveita.
    const existentes = await supabaseAdmin.select(
      'assinaturas',
      `tutor_id=eq.${tutor.id}&status=in.(ativa,pendente)&select=*`
    );
    if (existentes && existentes.length) {
      res.status(409).json({
        error: 'Você já tem uma assinatura ativa ou em processamento. Veja em "Meu plano" no painel.',
      });
      return;
    }

    const [assinatura] = await supabaseAdmin.insert('assinaturas', [
      {
        tutor_id: tutor.id,
        plano: planoKey,
        status: 'pendente',
        max_pets: plano.max_pets,
        tags_incluidas: plano.tags_incluidas,
        valor_centavos: Math.round(plano.valor * 100),
      },
    ]);

    const preapproval = {
      reason: plano.nome,
      external_reference: assinatura.id,
      payer_email: tutor.email,
      back_url: `${SITE_URL}/painel.html?assinatura=sucesso`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: plano.valor,
        currency_id: 'BRL',
      },
      status: 'pending',
    };

    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preapproval),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      await supabaseAdmin.update('assinaturas', `id=eq.${assinatura.id}`, {
        status: 'cancelada',
        payload: mpData,
      });
      throw new Error(`Mercado Pago recusou a assinatura: ${JSON.stringify(mpData)}`);
    }

    await supabaseAdmin.update('assinaturas', `id=eq.${assinatura.id}`, {
      mp_preapproval_id: mpData.id,
      payload: mpData,
    });

    res.status(200).json({ init_point: mpData.init_point, assinatura_id: assinatura.id });
  } catch (err) {
    console.error('create-subscription error:', err);
    res.status(500).json({ error: 'Não foi possível iniciar a assinatura. Tente novamente em instantes.' });
  }
};
