import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Provider = "openrouter" | "huggingface" | "gemini" | "groq";

type ProviderFailure = Error & {
  status?: number;
  retryAfterSec?: number;
};

type KeyState = {
  key_id: string;
  last_used_at: string | null;
  cooldown_until: string | null;
  fail_count: number;
};

type KeyCandidate = {
  key: string;
  keyId: string;
  state: KeyState | null;
};

type DbError = { message: string } | null;

type QueryResult<T> = {
  data: T[] | null;
  error: DbError;
};

type ServiceClient = {
  from(table: "ai_key_state"): {
    select(columns: string): {
      eq(column: string, value: string): {
        in(column: string, values: string[]): Promise<QueryResult<KeyState>>;
      };
    };
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<{ error: DbError }>;
  };
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: DbError }>;
};

type Quota = {
  allowed?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  reason?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const USER_DAILY_LIMIT = readInt("AI_DAILY_REQUESTS", 30, 1, 10000);
const GLOBAL_DAILY_LIMIT = readInt(
  "AI_GLOBAL_DAILY_REQUESTS",
  1000,
  1,
  1000000,
);
const DEFAULT_MAX_TOKENS = readInt("AI_DEFAULT_MAX_TOKENS", 900, 64, 8000);
const HARD_MAX_TOKENS = readInt("AI_MAX_TOKENS", 1800, 64, 8000);
const MAX_SYSTEM_CHARS = readInt("AI_MAX_SYSTEM_CHARS", 12000, 1000, 50000);
const MAX_USER_CHARS = readInt("AI_MAX_USER_CHARS", 20000, 1000, 100000);
const PROVIDER_TIMEOUT_MS = readInt(
  "AI_PROVIDER_TIMEOUT_MS",
  30000,
  5000,
  120000,
);

const DEFAULT_PROVIDER_ORDER: Provider[] = [
  "openrouter",
  "gemini",
  "groq",
  "huggingface",
];

const MODELS: Record<Provider, string> = {
  openrouter: Deno.env.get("OPENROUTER_MODEL") ||
    "nvidia/nemotron-3.5-lightning:free",
  huggingface: Deno.env.get("HF_MODEL") || "meta-llama/Llama-3.1-8B-Instruct",
  gemini: Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash",
  groq: Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile",
};

const APP_ORIGINS = (Deno.env.get("APP_ORIGINS") ??
  "https://fabioribeiro18.github.io,http://localhost:8765,http://127.0.0.1:8765")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let serviceClient: ServiceClient | null = null;

function readInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number.parseInt(Deno.env.get(name) ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function service(): ServiceClient {
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as ServiceClient;
  }
  return serviceClient;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  if (APP_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function parseKeys(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  let parts: string[] = [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) parts = parsed.map((item) => String(item));
    } catch {
      parts = [];
    }
  }
  if (!parts.length) parts = value.split(/[\n,]+/);
  return Array.from(
    new Set(
      parts
        .map((key) => key.trim())
        .filter((key) => key.length >= 8 && !key.startsWith("#")),
    ),
  );
}

function keysFor(provider: Provider): string[] {
  if (provider === "huggingface") {
    return parseKeys(
      Deno.env.get("HUGGINGFACE_KEYS") ?? Deno.env.get("HF_KEYS") ?? "",
    );
  }
  return parseKeys(Deno.env.get(`${provider.toUpperCase()}_KEYS`) ?? "");
}

function providerOrder(): Provider[] {
  const configured = (Deno.env.get("AI_PROVIDER_ORDER") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is Provider =>
      item === "openrouter" || item === "huggingface" || item === "gemini" ||
      item === "groq"
    );
  return configured.length ? configured : DEFAULT_PROVIDER_ORDER;
}

function makeFailure(
  message: string,
  status = 0,
  retryAfterSec = 0,
): ProviderFailure {
  const error = new Error(message) as ProviderFailure;
  error.status = status;
  error.retryAfterSec = retryAfterSec;
  return error;
}

function isProviderFailure(error: unknown): error is ProviderFailure {
  return error instanceof Error &&
    typeof (error as ProviderFailure).status === "number";
}

function errorText(data: unknown, raw: string, status: number): string {
  const obj = data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
  const nested = obj.error && typeof obj.error === "object"
    ? (obj.error as Record<string, unknown>)
    : {};
  const candidates = [nested.message, obj.error, obj.message, obj.detail, raw];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 300);
    }
  }
  return `Provider HTTP ${status}`;
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const retryAfter =
        Number.parseInt(response.headers.get("retry-after") ?? "0", 10) || 0;
      throw makeFailure(
        errorText(data, raw, response.status),
        response.status,
        retryAfter,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw makeFailure("O provider demorou demasiado a responder.", 504);
    }
    if (isProviderFailure(error)) throw error;
    throw makeFailure("Falha de rede ao contactar o provider.", 0);
  } finally {
    clearTimeout(timer);
  }
}

function cooldownSeconds(status: number, retryAfterSec: number): number {
  if (status === 401 || status === 403) return 6 * 60 * 60;
  if (status === 429) {
    return Math.min(6 * 60 * 60, Math.max(60, retryAfterSec || 60));
  }
  if (status === 400) return 10 * 60;
  if (status >= 500) return 60;
  return 30;
}

async function fingerprint(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function keyCandidates(
  provider: Provider,
  keys: string[],
): Promise<KeyCandidate[]> {
  const ids = await Promise.all(keys.map(fingerprint));
  let data: KeyState[] | null = null;
  try {
    const result = await service()
      .from("ai_key_state")
      .select("key_id,last_used_at,cooldown_until,fail_count")
      .eq("provider", provider)
      .in("key_id", ids);
    if (result.error) {
      console.error("ai_key_state read failed:", result.error.message);
    } else {
      data = result.data;
    }
  } catch (error) {
    console.error("ai_key_state read threw:", error);
  }
  const stateById = new Map<string, KeyState>();
  for (const row of data ?? []) stateById.set(row.key_id, row);
  return keys.map((key, index) => ({
    key,
    keyId: ids[index],
    state: stateById.get(ids[index]) ?? null,
  }));
}

function availableCandidates(candidates: KeyCandidate[]): KeyCandidate[] {
  const now = Date.now();
  return candidates
    .filter((candidate) => {
      if (!candidate.state?.cooldown_until) return true;
      const until = Date.parse(candidate.state.cooldown_until);
      return !Number.isFinite(until) || until <= now;
    })
    .sort((a, b) => {
      const aUsed = a.state?.last_used_at
        ? Date.parse(a.state.last_used_at) || 0
        : 0;
      const bUsed = b.state?.last_used_at
        ? Date.parse(b.state.last_used_at) || 0
        : 0;
      return aUsed - bUsed || a.keyId.localeCompare(b.keyId);
    });
}

async function markKeySuccess(
  provider: Provider,
  keyId: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const { error } = await service().from("ai_key_state").upsert({
      provider,
      key_id: keyId,
      last_used_at: now,
      cooldown_until: null,
      fail_count: 0,
      last_error: null,
      updated_at: now,
    }, { onConflict: "provider,key_id" });
    if (error) {
      console.error("ai_key_state success write failed:", error.message);
    }
  } catch (error) {
    console.error("ai_key_state success write threw:", error);
  }
}

async function markKeyFailure(
  provider: Provider,
  candidate: KeyCandidate,
  failure: ProviderFailure,
): Promise<void> {
  const status = failure.status ?? 0;
  const until = new Date(
    Date.now() + cooldownSeconds(status, failure.retryAfterSec ?? 0) * 1000,
  )
    .toISOString();
  try {
    const { error } = await service().from("ai_key_state").upsert({
      provider,
      key_id: candidate.keyId,
      last_used_at: candidate.state?.last_used_at ?? null,
      cooldown_until: until,
      fail_count: (candidate.state?.fail_count ?? 0) + 1,
      last_error: failure.message.slice(0, 200),
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,key_id" });
    if (error) {
      console.error("ai_key_state failure write failed:", error.message);
    }
  } catch (error) {
    console.error("ai_key_state failure write threw:", error);
  }
}

async function callOpenAICompatible(
  provider: Provider,
  url: string,
  key: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<{ text: string; provider: Provider; model: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] =
      "https://fabioribeiro18.github.io/diario-de-vida/";
    headers["X-Title"] = "Diario de Vida";
  }
  const data = await requestJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const text =
    (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw makeFailure("O provider devolveu uma resposta vazia.", 502);
  }
  return { text: text.trim(), provider, model };
}

async function callGemini(
  key: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<{ text: string; provider: Provider; model: string }> {
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${
    encodeURIComponent(model)
  }:generateContent?key=${encodeURIComponent(key)}`;
  const data = await requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
    }),
  });
  const text = (data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  })?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw makeFailure("O Gemini devolveu uma resposta vazia.", 502);
  }
  return { text: text.trim(), provider: "gemini", model };
}

function callProvider(
  provider: Provider,
  key: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<{ text: string; provider: Provider; model: string }> {
  if (provider === "openrouter") {
    return callOpenAICompatible(
      provider,
      "https://openrouter.ai/api/v1/chat/completions",
      key,
      MODELS.openrouter,
      systemPrompt,
      userPrompt,
      maxTokens,
    );
  }
  if (provider === "huggingface") {
    return callOpenAICompatible(
      provider,
      "https://router.huggingface.co/v1/chat/completions",
      key,
      MODELS.huggingface,
      systemPrompt,
      userPrompt,
      maxTokens,
    );
  }
  if (provider === "groq") {
    return callOpenAICompatible(
      provider,
      "https://api.groq.com/openai/v1/chat/completions",
      key,
      MODELS.groq,
      systemPrompt,
      userPrompt,
      maxTokens,
    );
  }
  return callGemini(key, systemPrompt, userPrompt, maxTokens);
}

async function refundRequest(userId: string): Promise<void> {
  try {
    const { error } = await service().rpc("ai_refund_request", {
      p_user_id: userId,
    });
    if (error) console.error("ai_refund_request failed:", error.message);
  } catch (error) {
    console.error("ai_refund_request threw:", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Método não permitido." }, 405);
  }
  if (!originAllowed(req)) {
    return json(req, { error: "Origem não autorizada." }, 403);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error("ai-proxy is missing Supabase environment variables.");
    return json(req, { error: "IA não configurada no servidor." }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(
      req,
      { error: "Sessão necessária para usar a IA incluída." },
      401,
    );
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(
    authHeader.slice(7),
  );
  if (authError || !authData.user) {
    return json(req, { error: "Sessão inválida. Entra novamente." }, 401);
  }
  const userId = authData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Pedido inválido." }, 400);
  }
  if (!body || typeof body !== "object") {
    return json(req, { error: "Pedido inválido." }, 400);
  }

  if (body.action === "status") {
    const { data, error } = await service().rpc("ai_usage_status", {
      p_user_id: userId,
      p_user_max: USER_DAILY_LIMIT,
      p_global_max: GLOBAL_DAILY_LIMIT,
    });
    if (error) {
      console.error("ai_usage_status failed:", error.message);
      return json(req, { error: "Estado da IA indisponível." }, 503);
    }
    return json(req, data ?? {});
  }
  if (body.action !== undefined) {
    return json(req, { error: "Ação desconhecida." }, 400);
  }

  const systemPrompt = typeof body.systemPrompt === "string"
    ? body.systemPrompt.trim()
    : "";
  const userPrompt = typeof body.userPrompt === "string"
    ? body.userPrompt.trim()
    : "";
  if (!userPrompt) {
    return json(req, { error: "Pedido vazio." }, 400);
  }
  if (
    systemPrompt.length > MAX_SYSTEM_CHARS || userPrompt.length > MAX_USER_CHARS
  ) {
    return json(req, { error: "Pedido demasiado longo." }, 413);
  }

  const requestedTokens = Number(body.maxTokens);
  const maxTokens = Number.isFinite(requestedTokens)
    ? Math.min(HARD_MAX_TOKENS, Math.max(64, Math.trunc(requestedTokens)))
    : DEFAULT_MAX_TOKENS;
  const purpose =
    typeof body.purpose === "string" && /^[a-z0-9-]{1,40}$/.test(body.purpose)
      ? body.purpose
      : "app";

  const { data: quotaData, error: quotaError } = await service().rpc(
    "ai_reserve_request",
    {
      p_user_id: userId,
      p_user_max: USER_DAILY_LIMIT,
      p_global_max: GLOBAL_DAILY_LIMIT,
    },
  );
  const quota = quotaData as Quota | null;
  if (quotaError) {
    console.error("ai_reserve_request failed:", quotaError.message);
    return json(req, { error: "IA temporariamente indisponível." }, 503);
  }
  if (!quota || quota.allowed !== true) {
    return json(req, {
      error: "Limite diário de IA atingido. Tenta novamente amanhã.",
      code: "quota_exceeded",
      usage: quota ?? {},
    }, 429);
  }

  let lastFailure: ProviderFailure | null = null;
  let sawKeys = false;

  for (const provider of providerOrder()) {
    const keys = keysFor(provider);
    if (!keys.length) continue;
    sawKeys = true;
    const candidates = availableCandidates(await keyCandidates(provider, keys));
    for (const candidate of candidates) {
      let result: { text: string; provider: Provider; model: string };
      try {
        result = await callProvider(
          provider,
          candidate.key,
          systemPrompt,
          userPrompt,
          maxTokens,
        );
      } catch (error) {
        const failure = isProviderFailure(error) ? error : makeFailure(
          error instanceof Error ? error.message : "Falha desconhecida.",
          0,
        );
        lastFailure = failure;
        console.warn(
          `ai-proxy ${provider} key failed:`,
          failure.status,
          failure.message,
        );
        await markKeyFailure(provider, candidate, failure);
        continue;
      }
      await markKeySuccess(provider, candidate.keyId);
      try {
        const { error: usageError } = await service().rpc("ai_record_usage", {
          p_user_id: userId,
          p_input_chars: systemPrompt.length + userPrompt.length,
          p_output_chars: result.text.length,
        });
        if (usageError) {
          console.error("ai_record_usage failed:", usageError.message);
        }
      } catch (error) {
        console.error("ai_record_usage threw:", error);
      }
      return json(req, {
        text: result.text,
        provider: result.provider,
        model: result.model,
        purpose,
        usage: quota,
      });
    }
  }

  await refundRequest(userId);

  if (!sawKeys) {
    console.error("ai-proxy has no provider keys configured.");
    return json(
      req,
      { error: "IA ainda não está configurada no servidor." },
      503,
    );
  }

  console.error(
    "ai-proxy exhausted providers:",
    lastFailure?.status,
    lastFailure?.message,
  );
  return json(req, {
    error:
      "IA temporariamente indisponível. Tenta novamente dentro de instantes.",
    code: "ai_unavailable",
  }, 503);
});
