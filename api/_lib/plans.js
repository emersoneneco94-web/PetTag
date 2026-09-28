// Catálogo de planos e preços — fonte única da verdade no servidor.
// NUNCA confie em preço enviado pelo cliente: o valor cobrado sempre vem
// deste arquivo, nunca do corpo da requisição.
// Se você mudar preços no site (index.html #planos), atualize aqui também.

const PLANOS_RECORRENTES = {
  save_tag: {
    nome: 'Plano Save Tag',
    valor: 9.90,
    max_pets: 2,
    tags_incluidas: 2,
  },
  save_tag_familia: {
    nome: 'Plano Save Tag Família',
    valor: 19.90,
    max_pets: 4,
    tags_incluidas: 4,
  },
};

const PRODUTOS_AVULSOS = {
  tag_avulsa: {
    nome: 'TAG Avulsa Save Tag Pet',
    valor: 49.90,
    tags: 1,
  },
  tag_extra: {
    nome: 'TAG extra Save Tag Pet',
    valor: 29.90,
    tags: 1,
  },
};

module.exports = { PLANOS_RECORRENTES, PRODUTOS_AVULSOS };
