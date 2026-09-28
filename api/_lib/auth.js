// Valida o token de sessão do tutor (enviado pelo frontend no header
// Authorization: Bearer <access_token>, obtido de supabaseClient.auth.getSession())
// contra o endpoint de auth do Supabase. Isso garante que o tutor_id gravado
// no pedido/assinatura é sempre o do usuário realmente autenticado — nunca
// um valor que o cliente poderia forjar no corpo da requisição.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function getTutorFromRequest(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const accessToken = authHeader.slice('Bearer '.length).trim();
  if (!accessToken) return null;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Faltam SUPABASE_URL / SUPABASE_ANON_KEY nas variáveis de ambiente.');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return user; // { id, email, user_metadata, ... }
}

module.exports = { getTutorFromRequest };
