import Anthropic from '@anthropic-ai/sdk';
import { stripSignature, stripSubjectPrefix } from './text-utils.js';

// Stable system prompt — content is identical across all classifications
// so prompt caching can deduplicate the system tokens (cache_control below).
// Kept in Slovak so the model anchors on Slovak helpdesk vocabulary.
const SYSTEM_PROMPT = `Si klasifikátor helpdesk ticketov pre platformu CREATIVE sites (SaaS e-commerce v SK/CZ regióne).

Tvojou úlohou je každý ticket zaradiť do PRESNE jednej zo 4 kategórií:

══ ZP — Zákaznícka podpora ══════════════════════════════
Otázky používateľov o tom, ako platforma funguje, ako niečo nastaviť v admine,
žiadosti o info/návod. Zákazník sa pýta, NIE žiada implementáciu.
Príklady:
- "Otázka na funkčnosť jazyková mutácia CZ"
- "Ako môžem pridať novú kategóriu produktov?"
- "Potrebujem informácie o platobných bránach"
- "Filter pre sledovanie zásielky"
- "Ako zobraziť zľavu na produkte"

══ TP — Technická podpora ═══════════════════════════════
Žiadosti o programátorskú prácu — vývoj, integrácia, custom úpravy, spustenie
nových funkcií, ktoré vyžadujú zásah developera.
Príklady:
- "Spustenie EL,EN jazykovej mutácie"
- "Návrh na CSAPI integráciu"
- "Úprava designu menu / nový modul"
- "Pripojenie na externý ERP systém"
- "Programovanie custom pluginu"

══ BUG — Chyba/Incident ═════════════════════════════════
Niečo nefunguje ako má, je tam defekt, error, neočakávané správanie.
Zákazník hovorí "nefunguje", "chyba", "rozbité", "stratil sa".
Príklady:
- "Nefunguje pridávanie do košíka"
- "Chybne sa zobrazuje cena na stránke"
- "Po update sa stratil obsah kategórie"
- "Bug - zobrazovanie horného segmentu"
- "Problém s importom obrázkov"

══ URGENT_BUG — Urgentný BUG ════════════════════════════
KRITICKÉ chyby blokujúce biznis. Eshop down, platby nefungujú, klient nevie
predať, výpadok celej funkcionality, kritická data loss. Bežné slovo "urgent"
SAMOTNÉ na to nestačí — musí byť SKUTOČNE kritické.
Príklady:
- "URGENTNE - eshop nefunguje, klienti nevedia objednať!"
- "Platby nefungujú, výpadok"
- "Stratil sa celý katalóg, je to kritické"

══ ROZHODOVACIE PRAVIDLÁ ════════════════════════════════
1. "Ako" + popis fungovania = ZP (otázka)
2. "Spustite/Implementujte/Pripojte" = TP (žiadosť o prácu)
3. "Nefunguje/Chyba/Stratilo sa" = BUG
4. BUG s "kritické/výpadok/blokuje predaj/eshop down" = URGENT_BUG
5. Pri pochybnostiach medzi ZP/TP: ak by si mal volať programátora = TP
6. Pri pochybnostiach medzi BUG/URGENT_BUG: ak eshop FUNGUJE inak, je to BUG

══ VÝSTUP ══════════════════════════════════════════════
Vráť IBA validný JSON v presne tomto formáte (nič iné, žiadny markdown):
{"classification":"ZP|TP|BUG|URGENT_BUG","confidence":0-100,"reasoning":"krátke vysvetlenie po slovensky, max 120 znakov"}`;

export function createAiClient(apiKey) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
  return new Anthropic({ apiKey });
}

function extractJson(text) {
  // 1) ```json ... ``` block
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1];
  // 2) Last balanced {...} block (model often writes reasoning before JSON)
  let depth = 0, start = -1, lastValid = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) lastValid = text.slice(start, i + 1); }
  }
  if (lastValid) return lastValid;
  // 3) First {...?...} non-greedy
  const m = text.match(/\{[\s\S]*?\}/);
  return m ? m[0] : null;
}

export async function classifyTicket(client, ticket, { model = 'claude-haiku-4-5', maxBodyChars = 3000 } = {}) {
  // Same cleanup pipeline as rule generation:
  //  - strip Re:/Fwd:/Odp: prefixes from subject (model doesn't need to see them)
  //  - strip signature, quoted reply blocks, URLs, ticket codes, emails, dates from body
  // Saves input tokens AND prevents the model from anchoring on quoted agent text.
  const subject = stripSubjectPrefix(ticket.subject || '').slice(0, 300);
  const rawBody = ticket.first_customer_message?.plain_text || '';
  const body = stripSignature(rawBody).slice(0, maxBodyChars);
  const userPrompt = `Subject: ${subject || '(prázdny subject)'}\n\nBody:\n${body || '(prázdne body)'}`;

  const response = await client.messages.create({
    model,
    max_tokens: 600,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const jsonStr = extractJson(text);
  if (!jsonStr) {
    const err = new Error(`No JSON in response | raw: ${text.slice(0, 250).replace(/\n/g, ' ')}`);
    err.raw = text;
    err.kind = 'no_json';
    throw err;
  }

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) {
    const err = new Error(`Invalid JSON syntax | raw: ${jsonStr.slice(0, 250).replace(/\n/g, ' ')}`);
    err.raw = text;
    err.kind = 'parse_error';
    throw err;
  }

  if (!['ZP', 'TP', 'BUG', 'URGENT_BUG'].includes(parsed.classification)) {
    const err = new Error(`Invalid classification value: "${parsed.classification}" | raw: ${text.slice(0, 200).replace(/\n/g, ' ')}`);
    err.raw = text;
    err.kind = 'bad_class';
    throw err;
  }

  return {
    classification: parsed.classification,
    confidence: Number(parsed.confidence) || 0,
    reasoning: String(parsed.reasoning || '').slice(0, 200),
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
