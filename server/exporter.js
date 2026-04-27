function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function ticketsToCsv(tickets) {
  const header = 'id,code,subject,date_created,classification,owner_email,owner_domain,agentid';
  const rows = tickets.map(t => [
    t.id, t.code ?? '', t.subject ?? '', t.date_created ?? '', t.classification ?? '',
    t.owner?.email ?? '', t.owner?.domain ?? '', t.agentid ?? '',
  ].map(csvEscape).join(','));
  return [header, ...rows].join('\n');
}

export function rulesToMarkdown(rules) {
  const lines = [`# Navrhované LA pravidlá`, ``, `Celkom: **${rules.length}** pravidiel`, ``];
  for (const r of rules) {
    lines.push(`## ${r.id} — ${r.human_readable}`, '');
    lines.push(`- **Pole:** \`${r.condition.field}\``);
    lines.push(`- **Operátor:** \`${r.condition.operator}\``);
    lines.push(`- **Hodnota:** \`${r.condition.value}\``);
    lines.push(`- **Klasifikácia:** **${r.action.classification}**`);
    lines.push('');
    lines.push(`**Štatistiky:**`);
    lines.push(`- matches: ${r.stats.matches_total}`);
    lines.push(`- true positives: ${r.stats.true_positives}`);
    lines.push(`- false positives: ${r.stats.false_positives}`);
    lines.push(`- **confidence: ${r.stats.confidence_percent}%**`);
    lines.push(`- **coverage: ${r.stats.coverage_percent}%**`);
    if (r.examples?.length) {
      lines.push('', '**Príklady:**');
      for (const ex of r.examples.slice(0, 3)) {
        lines.push(`- \`${ex.ticket_id}\` — ${ex.subject}`);
      }
    }
    if (r.false_positive_examples?.length) {
      lines.push('', '**False positives:**');
      for (const ex of r.false_positive_examples.slice(0, 3)) {
        lines.push(`- \`${ex.ticket_id}\` — ${ex.subject} (skutočne: ${ex.actual_classification})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
