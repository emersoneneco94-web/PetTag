// Cliente Supabase "admin" para uso exclusivo dentro das funções serverless
// (/api). Usa a SERVICE ROLE KEY, que ignora RLS — por isso NUNCA deve ser
// exposta no frontend, só em variáveis de ambiente do servidor na Vercel.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfigured() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      'Faltam variáveis de ambiente SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY na Vercel.'
    );
  }
}

async function supabaseAdminRequest(path, { method = 'GET', body, headers = {} } = {}) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${path} falhou: ${res.status}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }

  return data;
}

// Helpers REST simples (equivalentes ao supabase-js, sem precisar instalar o pacote)
const supabaseAdmin = {
  async select(table, query) {
    const qs = query ? `?${query}` : '';
    return supabaseAdminRequest(`/rest/v1/${table}${qs}`, {
      headers: { Prefer: 'return=representation' },
    });
  },
  async insert(table, rows) {
    return supabaseAdminRequest(`/rest/v1/${table}`, {
      method: 'POST',
      body: rows,
      headers: { Prefer: 'return=representation' },
    });
  },
  async update(table, query, patch) {
    return supabaseAdminRequest(`/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      body: patch,
      headers: { Prefer: 'return=representation' },
    });
  },
  async rpc(fn, args) {
    return supabaseAdminRequest(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      body: args || {},
    });
  },
};

module.exports = { supabaseAdmin };
