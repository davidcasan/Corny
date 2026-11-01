// User-Agent descritivo: a Wikimedia exige um para clientes de API
export const BOT_USER_AGENT = 'CornyGame/2.0 (jogo privado; https://github.com/davidcasan)';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function request(url, { headers = {}, timeoutMs = 8000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': BOT_USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw new Error(err.name === 'TimeoutError' ? 'tempo esgotado' : err.message);
    }

    if (res.ok) return res;
    if (RETRYABLE.has(res.status) && attempt < retries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function getJson(url, options) {
  return (await request(url, options)).json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
