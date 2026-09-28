// POST /api/mercadopago/cancel-subscription
// Cancela a assinatura ativa do tutor autenticado (usado pelo botão
// "Cancelar assinatura" no painel).

const { supabaseAdmin } = require('../_lib/supabaseAdmin');
const { getTutorFromRequest } = require('../_lib/auth');

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    const tutor = await getTutorFromRequest(req);
    if (!tutor) {
      res.status(401).json({ error: 'Faça login novamente.' });
      return;
    }

    const [assinatura] = await supabaseAdmin.select(
      'assinaturas',
      `tutor_id=eq.${tutor.id}&status=eq.ativa&select=*`
    );

    if (!assinatura) {
      res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada.' });
      return;
    }

    if (assinatura.mp_preapproval_id) {
      await fetch(`https://api.mercadopago.com/preapproval/${assinatura.mp_preapproval_id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      });
    }

    await supabaseAdmin.update('assinaturas', `id=eq.${assinatura.id}`, {
      status: 'cancelada',
      updated_at: new Date().toISOString(),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('cancel-subscription error:', err);
    res.status(500).json({ error: 'Não foi possível cancelar agora. Tente novamente.' });
  }
};
