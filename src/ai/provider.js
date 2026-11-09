// AI provider abstraction (Milestone 4).
// Two providers:
//   - 'gemini': real Gemini API via @google/generative-ai. Never invents
//     content: on failure it throws a clear error after retries.
//   - 'mock': deterministic canned responses chosen by prompt keywords,
//     for tests and offline development. It NEVER claims to be real
//     Gemini output; every response is labelled as mock output.
// Selection: config.aiProvider ('gemini' | 'mock'), otherwise mockMode
// selects 'mock' and live mode selects 'gemini'.
//
// generate({ prompt, system, tools }) returns:
//   { text, toolCalls: [{ name, args }], usage: { promptTokens, completionTokens } }
// `tools` is an array of { name, description?, parameters? } declarations.
// The Gemini provider enforces config.geminiTimeoutMs via AbortSignal.timeout
// and retries transient failures up to 2 times with exponential backoff.

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MODEL = 'gemini-1.5-flash';

// Rough deterministic token estimate for the mock provider only
// (word count; never presented as a real Gemini usage count).
function estimateTokens(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

// Canned responses, first matching rule wins. Rules are checked in this
// fixed order so output is fully deterministic for a given prompt.
const MOCK_RULES = [
  {
    keywords: ['diagnos', 'site is down', 'website is down', 'website down', 'not loading', 'error 500', 'error 502', 'error 503', 'ssl', 'dns', 'site down'],
    text: '[mock] Diagnosis note: the site availability problem was noted for investigation. No live checks were run by the mock provider, so no real diagnostic finding is claimed here.',
  },
  {
    keywords: ['screenshot', 'browse', 'open the site', 'visit the site', 'cpanel', 'log in'],
    text: '[mock] Browser note: a browser step was noted for investigation. The mock provider cannot drive a real browser, so no page was actually visited.',
  },
  {
    keywords: ['reply', 'respond to the customer', 'draft a reply', 'customer message', 'customer said'],
    text: '[mock] Draft reply note: a customer reply was requested. This is a canned mock draft only and must be reviewed by a human before sending.',
  },
  {
    keywords: ['create email', 'change password', 'subdomain', 'addon domain', 'dns record', 'backup', 'quota'],
    text: '[mock] Operations note: a hosting operation was requested. The mock provider performs no real operations; this request needs human approval before any action.',
  },
  {
    keywords: ['pricing', 'price', 'plans', 'how much', 'refund', 'policy'],
    text: '[mock] Knowledge note: pricing/policy information was requested. The mock provider holds no verified pricing data; check the knowledge base before answering.',
  },
  {
    keywords: ['status', 'uptime', 'is it up', 'server status'],
    text: '[mock] Status note: a status check was requested. The mock provider has no live server access, so no real status is claimed here.',
  },
];

// Split a tool name into searchable words, e.g. 'checkDns' -> ['check','dns'],
// 'check_dns' -> ['check','dns'].
function toolNameWords(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2);
}

function createMockProvider() {
  async function generate({ prompt = '', system = '', tools = [] } = {}) {
    const haystack = `${system}\n${prompt}`.toLowerCase();
    const rule = MOCK_RULES.find((r) => r.keywords.some((k) => haystack.includes(k)));
    const text = rule
      ? rule.text
      : '[mock] Canned mock response: no keyword rule matched this prompt. This is mock output, not real Gemini output.';
    // Tool calling: if the caller supplied tool declarations and the prompt
    // mentions one of them (by a word from its name), return a single
    // deterministic tool call for the first matching tool. Otherwise none.
    const toolCalls = [];
    const declarations = Array.isArray(tools) ? tools : [];
    for (const tool of declarations) {
      const name = typeof tool === 'string' ? tool : tool?.name;
      if (!name) continue;
      const words = toolNameWords(name);
      if (words.some((w) => haystack.includes(w))) {
        toolCalls.push({ name, args: {} });
        break;
      }
    }
    return {
      text,
      toolCalls,
      usage: {
        promptTokens: estimateTokens(prompt),
        completionTokens: estimateTokens(text),
      },
    };
  }
  return { name: 'mock', generate };
}

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------

function createGeminiProvider(config, logger) {
  if (!config.geminiApiKey) {
    throw new Error(
      'GEMINI_API_KEY is required to use the gemini provider. ' +
        'Set GEMINI_API_KEY in the environment, or use the mock provider (MOCK_MODE=true).',
    );
  }
  const modelName = config.geminiModel || DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(config.geminiTimeoutMs) ? config.geminiTimeoutMs : DEFAULT_TIMEOUT_MS;
  const log = logger ?? { debug() {}, info() {}, warn() {}, error() {} };

  // Lazily import the SDK and build the model on first use, so constructing
  // the provider never touches the network.
  let modelPromise = null;
  function getModel() {
    if (!modelPromise) {
      modelPromise = import('@google/generative-ai').then(({ GoogleGenerativeAI }) => {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        return genAI.getGenerativeModel({ model: modelName });
      });
    }
    return modelPromise;
  }

  async function generateOnce({ prompt, system, tools }) {
    const model = await getModel();
    const request = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { role: 'system', parts: [{ text: system }] } } : {}),
      ...(Array.isArray(tools) && tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description || `Tool: ${t.name}`,
                  ...(t.parameters ? { parameters: t.parameters } : {}),
                })),
              },
            ],
          }
        : {}),
    };
    // Timeout enforced by the SDK via the abort signal.
    const result = await model.generateContent(request, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const response = result.response;
    const text = typeof response.text === 'function' ? response.text() : '';
    const functionCalls =
      typeof response.functionCalls === 'function' ? response.functionCalls() : [];
    const usageMetadata = response.usageMetadata ?? {};
    return {
      text,
      toolCalls: functionCalls.map((fc) => ({ name: fc.name, args: fc.args ?? {} })),
      usage: {
        promptTokens: usageMetadata.promptTokenCount ?? 0,
        completionTokens: usageMetadata.candidatesTokenCount ?? 0,
      },
    };
  }

  async function generate(args) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await generateOnce(args);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
          log.warn(`Gemini request failed (attempt ${attempt + 1}), retrying in ${delayMs}ms`, {
            error: String(err?.message ?? err),
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    // Never return invented content on failure: throw a clear error.
    throw new Error(
      `Gemini request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? lastError}`,
    );
  }

  return { name: 'gemini', generate };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAiProvider(config = {}, logger) {
  const providerName = config.aiProvider || (config.mockMode ? 'mock' : 'gemini');
  if (providerName === 'gemini') return createGeminiProvider(config, logger);
  if (providerName === 'mock') return createMockProvider(config, logger);
  throw new Error(`Unknown AI provider: ${providerName} (expected 'gemini' or 'mock')`);
}
