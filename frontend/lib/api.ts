export const API = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8095").replace(/\/$/, "");

export class ErroApi extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, msg: string) {
    super(msg);
    this.status = status;
    this.codigo = codigo;
  }
}

export async function api<T>(caminho: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 8000);
  try {
    const r = await fetch(`${API}${caminho}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const d = corpo?.detail;
      throw new ErroApi(r.status, d?.codigo || "erro", d?.mensagem || (Array.isArray(d) ? "dados inválidos" : `HTTP ${r.status}`));
    }
    return corpo as T;
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    throw new ErroApi(0, "indisponivel", "API indisponível no momento");
  } finally {
    clearTimeout(t);
  }
}

export async function dado<T>(arquivo: string): Promise<T> {
  const r = await fetch(`/data/${arquivo}`, { cache: "force-cache" });
  if (!r.ok) throw new Error(`artefato ausente: ${arquivo}`);
  return r.json();
}

export const fmt = {
  usd: (v: number | null | undefined, d = 0) =>
    v == null ? "N/D" : v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: d, minimumFractionDigits: d }),
  num: (v: number | null | undefined, d = 0) => (v == null ? "N/D" : v.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })),
  pct: (v: number | null | undefined, d = 1) => (v == null ? "N/D" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })}%`),
};

export const ROTULO_ACAO: Record<string, string> = { aprovar: "Aprovar", autenticar: "Verificação adicional", investigar: "Reter para investigação" };
