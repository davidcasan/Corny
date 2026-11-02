// SQLite grava em UTC sem fuso ("2026-02-19 13:45:00"): mostra no horário local
export function formatDate(sqliteDate) {
  return new Date(`${sqliteDate.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// Chave de busca: sem acentos e sem maiúsculas
export function searchKey(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
