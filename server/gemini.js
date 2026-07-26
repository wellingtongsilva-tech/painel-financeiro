/*
 * Cliente Gemini (Google Generative Language API) — só texto.
 * Robusto de propósito: modelo configurável com CADEIA DE FALLBACK (modelos
 * são aposentados de tempos em tempos → 404), timeout, e erros que degradam
 * sem derrubar a análise local. Precisa de GEMINI_API_KEY no ambiente.
 *
 * .env: GEMINI_API_KEY (obrigatória p/ a camada de IA)
 *       GEMINI_MODEL (opcional; CSV de modelos a tentar em ordem)
 */
const KEY = process.env.GEMINI_API_KEY || '';
// gemini-flash-latest primeiro: alias que o Google mantém atual (modelos com
// versão fixa como 2.0-flash/1.5-flash são aposentados e dão 404).
const MODELS = (process.env.GEMINI_MODEL || 'gemini-flash-latest,gemini-2.5-flash,gemini-pro-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);

export const geminiConfigured = () => !!KEY;

export async function geminiText(prompt, { system, maxTokens = 800, temperature = 0.4 } = {}) {
  if (!KEY) throw new Error('IA não configurada (falta GEMINI_API_KEY no servidor).');
  let lastErr;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        lastErr = new Error(`Gemini ${model}: HTTP ${r.status}`);
        // modelo inexistente/aposentado ou request inválido → tenta o próximo
        if (r.status === 404 || r.status === 400) continue;
        // 403 (chave), 429 (limite), 5xx → não adianta trocar modelo
        throw lastErr;
      }
      const data = await r.json();
      const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (text) return { text, model };
      lastErr = new Error(`Gemini ${model}: resposta vazia`);
    } catch (e) {
      clearTimeout(t);
      lastErr = e?.name === 'AbortError' ? new Error('Gemini: tempo esgotado') : e;
      if (e?.name === 'AbortError') continue;
    }
  }
  throw lastErr || new Error('Falha ao chamar o Gemini');
}
