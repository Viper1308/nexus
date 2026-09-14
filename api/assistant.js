/* ============================================================
   /api/assistant — Vercel serverless function.
   ------------------------------------------------------------
   Optional layer on top of the pet. If this isn't deployed or
   GROQ_API_KEY isn't set, js/pet.js catches the failure and quietly
   falls back to schedule + quick actions only — nothing breaks.

   Setup:
   1. Get a free key from https://console.groq.com
   2. In Vercel: Project -> Settings -> Environment Variables
      add GROQ_API_KEY = <your key>
   3. Redeploy.
   ============================================================ */

const PROVIDER_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const API_KEY_ENV = 'GROQ_API_KEY';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

  const key = process.env[API_KEY_ENV];
  if (!key) { res.status(500).json({ error: `${API_KEY_ENV} is not set.` }); return; }

  const { message, history, today } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Missing "message" string.' }); return;
  }

  const scheduleLine = Array.isArray(today) && today.length
    ? today.map(i => `- ${i.text}${i.done ? ' (done)' : ''}`).join('\n')
    : 'Nothing scheduled today.';

  const systemPrompt = `You are the user's NEXUS dashboard pet. Be brief, direct, a little warm.
You live in a small popover next to a full-body character, not a general chatbot -
keep replies to 1-3 sentences. Here is today's real schedule, pulled from their calendar:
${scheduleLine}
Use it when relevant. If asked about something you have no data for, say so plainly.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: message }
  ];

  try {
    const r = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, max_tokens: 300 })
    });
    if (!r.ok) { res.status(r.status).json({ error: 'Provider error', detail: await r.text() }); return; }
    const data = await r.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || "I didn't get a reply — try again.";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: 'Request to the LLM provider failed.', detail: String(e) });
  }
};

/* Swapping providers (all OpenAI-compatible):
   Gemini:     https://generativelanguage.googleapis.com/v1beta/openai/chat/completions, 'gemini-2.5-flash', GEMINI_API_KEY
   OpenRouter: https://openrouter.ai/api/v1/chat/completions, 'meta-llama/llama-3.3-70b-instruct:free', OPENROUTER_API_KEY
   Mistral:    https://api.mistral.ai/v1/chat/completions, 'mistral-small-latest', MISTRAL_API_KEY */
