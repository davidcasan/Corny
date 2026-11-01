export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Chama a API e devolve o JSON. Qualquer falha (rede, HTTP, success:false) vira ApiError.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Tente novamente.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Resposta sem JSON (ex.: erro do túnel)
  }

  if (!res.ok || !data?.success) {
    throw new ApiError(data?.message || `Erro ${res.status} no servidor`, res.status);
  }
  return data;
}
