// POST /api/whatsapp/found-alert
// Chamado pela página pública (public.html) quando alguém escaneia o QR/NFC
// de um pet marcado como "perdido" e toca em "Encontrei o pet".
// Dispara automaticamente uma mensagem de WhatsApp para o TUTOR REAL do pet
// (via Meta WhatsApp Cloud API) — diferente do botão wa.me antigo, que só
// abria o WhatsApp de quem encontrou e dependia dela apertar "enviar".
//
// Body esperado: { "pet_id": "uuid", "lat": number|null, "lng": number|null }
// Não exige login (quem escaneia o QR não tem conta).
//
// O envio fica registrado como uma linha em `tag_leituras` (mesma tabela já
// usada pelas RPCs registrar_leitura_tag/registrar_localizacao_leitura),
// nas colunas whatsapp_enviado / whatsapp_erro / meta_message_id.

const { supabaseAdmin } = require('../_lib/supabaseAdmin');

const WHATSAPP_TOKEN = process.env.WHATSAPP_CLOUD_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
// Nome do template aprovado no Meta Business Manager (veja o guia de setup).
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'pet_encontrado';
const WHATSAPP_TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'pt_BR';

const COOLDOWN_MINUTOS = 5; // evita spam de alertas repetidos pro mesmo pet

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido' });
    return;
  }

  try {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('Faltam WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID nas variáveis de ambiente.');
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const petId = body.pet_id;
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;

    if (!petId) {
      res.status(400).json({ error: 'pet_id é obrigatório.' });
      return;
    }

    const [pet] = await supabaseAdmin.select('pets', `id=eq.${petId}&select=*`);
    if (!pet) {
      res.status(404).json({ error: 'Pet não encontrado.' });
      return;
    }

    // Só dispara alerta automático se o pet realmente estiver em modo "perdido"
    // (evita disparos indevidos em perfis normais).
    const estaPerdido = pet.perdido === true || pet.is_lost === true;
    if (!estaPerdido) {
      res.status(200).json({ ok: false, skipped: 'pet_nao_esta_perdido' });
      return;
    }

    // Tag física vinculada a este pet (para registrar a leitura em tag_leituras,
    // igual ao que registrar_leitura_tag faria). Se por algum motivo não houver
    // tag vinculada, seguimos mesmo assim — só não gravamos o log detalhado.
    const [tag] = await supabaseAdmin.select('tags', `pet_id=eq.${petId}&select=id,codigo&limit=1`);

    // Cooldown: não reenvia alerta pro mesmo pet em menos de N minutos
    const recentes = await supabaseAdmin.select(
      'tag_leituras',
      `pet_id=eq.${petId}&origem=eq.whatsapp_alert&order=created_at.desc&limit=1&select=created_at`
    );
    if (recentes && recentes[0]) {
      const minutosDesdeUltimo = (Date.now() - new Date(recentes[0].created_at).getTime()) / 60000;
      if (minutosDesdeUltimo < COOLDOWN_MINUTOS) {
        res.status(200).json({ ok: true, skipped: 'cooldown_ativo' });
        return;
      }
    }

    const telefoneDestino = await resolverTelefoneTutor(pet);
    if (!telefoneDestino) {
      await registrarLeitura({ pet, tag, lat, lng, status: false, erro: 'telefone_nao_encontrado' });
      res.status(200).json({ ok: false, error: 'Tutor sem telefone cadastrado.' });
      return;
    }

    const mapsUrl = lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : '';
    const nomePet = pet.nome || pet.name || 'seu pet';

    const resultado = await enviarTemplateWhatsapp({
      telefone: telefoneDestino,
      nomePet,
      localizacaoUrl: mapsUrl,
    });

    await registrarLeitura({
      pet,
      tag,
      lat,
      lng,
      status: resultado.ok,
      erro: resultado.ok ? null : JSON.stringify(resultado.data),
      metaMessageId: resultado.ok ? resultado.data?.messages?.[0]?.id : null,
    });

    res.status(200).json({ ok: resultado.ok });
  } catch (err) {
    console.error('found-alert error:', err);
    res.status(500).json({ error: 'Não foi possível notificar o tutor agora.' });
  }
};

// Telefone do tutor: prioriza um contato específico de emergência cadastrado
// no próprio pet (pets.lost_contact, preenchido na tela "Meu pet está
// perdido"), depois pets.whatsapp/phone, e por fim o telefone cadastral do
// tutor em `tutores.telefone` (mesma fonte usada pela função get_pet_public
// já existente no banco).
async function resolverTelefoneTutor(pet) {
  const candidatoDireto = pet.lost_contact || pet.whatsapp || pet.phone || null;
  if (candidatoDireto) return candidatoDireto;

  if (pet.tutor_id) {
    const [tutor] = await supabaseAdmin.select('tutores', `id=eq.${pet.tutor_id}&select=telefone`);
    if (tutor && tutor.telefone) return tutor.telefone;
  }

  return null;
}

async function enviarTemplateWhatsapp({ telefone, nomePet, localizacaoUrl }) {
  const telefoneLimpo = String(telefone).replace(/\D/g, '');
  const telefoneE164 = telefoneLimpo.startsWith('55') ? telefoneLimpo : `55${telefoneLimpo}`;

  // O template precisa existir e estar APROVADO no Meta Business Manager
  // com 2 variáveis de corpo: {{1}} nome do pet, {{2}} link de localização
  // (texto "Localização não informada" quando não houver). Veja o guia.
  const payload = {
    messaging_product: 'whatsapp',
    to: telefoneE164,
    type: 'template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      language: { code: WHATSAPP_TEMPLATE_LANG },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nomePet },
            { type: 'text', text: localizacaoUrl || 'Localização não informada' },
          ],
        },
      ],
    },
  };

  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return { ok: res.ok, data };
}

async function registrarLeitura({ pet, tag, lat, lng, status, erro, metaMessageId }) {
  try {
    await supabaseAdmin.insert('tag_leituras', [
      {
        tag_id: tag ? tag.id : null,
        tag_codigo: tag ? tag.codigo : 'SEM_TAG_VINCULADA',
        pet_id: pet.id,
        perdido_na_leitura: true,
        latitude: lat,
        longitude: lng,
        localizacao_compartilhada: lat != null && lng != null,
        origem: 'whatsapp_alert',
        whatsapp_enviado: status,
        whatsapp_erro: erro || null,
        meta_message_id: metaMessageId || null,
      },
    ]);
  } catch (e) {
    console.error('Falha ao registrar leitura em tag_leituras:', e.details || e.message);
  }
}
