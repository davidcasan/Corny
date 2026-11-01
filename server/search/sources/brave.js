import { getJson } from '../http.js';

// Brave Search API (imagens): resultados da web inteira, como o Google Imagens.
// API oficial com chave: só é usada se BRAVE_API_KEY estiver no .env.
// Chave em https://api-dashboard.search.brave.com
export async function brave(name) {
  const params = new URLSearchParams({ q: name, count: '100', country: 'BR', search_lang: 'pt' });
  const data = await getJson(`https://api.search.brave.com/res/v1/images/search?${params}`, {
    headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' }
  });

  return (data.results ?? []).map(item => ({
    url: item.properties?.url,
    thumb: item.thumbnail?.src,
    width: item.properties?.width,
    height: item.properties?.height
  }));
}

export function braveEnabled() {
  return Boolean(process.env.BRAVE_API_KEY);
}
