export interface Operation {
  order: number;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
}

export function renderDryRun(operations: Operation[]): string {
  const lines: string[] = [];
  for (const op of operations) {
    lines.push(`${String(op.order).padEnd(3)}${op.kind.padEnd(24)}${op.summary}`);
  }

  const totals = new Map<string, number>();
  for (const op of operations) totals.set(op.kind, (totals.get(op.kind) ?? 0) + 1);

  lines.push('');
  lines.push('totals');
  for (const [kind, count] of [...totals.entries()].sort()) lines.push(`  ${kind}: ${count}`);
  lines.push('');
  lines.push(`dry run: nothing was mutated (${operations.length} operations planned)`);
  return lines.join('\n');
}
