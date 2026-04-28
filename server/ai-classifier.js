import Anthropic from '@anthropic-ai/sdk';

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

export async function classifyTicket(client, ticket, { model = 'claude-haiku-4-5', maxBodyChars = 3000 } = {}) {
  const subject = (ticket.subject || '').slice(0, 300);
  const body = (ticket.first_customer_message?.plain_text || '').slice(0, maxBodyChars);
  const userPrompt = `Subject: ${subject}\n\nBody:\n${body || '(prázdne)'}`;

  const response = await client.messages.create({
    model,
    max_tokens: 200,
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

  // Extract JSON object — model occasionally wraps in code fences despite instructions
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`No JSON object in AI response: ${text.slice(0, 200)}`);

  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { throw new Error(`Invalid JSON from AI: ${match[0].slice(0, 200)}`); }

  if (!['ZP', 'TP', 'BUG', 'URGENT_BUG'].includes(parsed.classification)) {
    throw new Error(`Invalid classification value: ${parsed.classification}`);
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
