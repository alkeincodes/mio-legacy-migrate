/**
 * The legacy editor stores rich text as a TipTap (ProseMirror) document,
 * serialised to JSON in `sections.title` (headlines), `settings.value`
 * (paragraphs) and `settings.link.url` (links). This turns one into plain text
 * or minimal HTML. Node types seen on the real hub: doc, paragraph, text,
 * hardBreak, bulletList, orderedList, listItem, personalisation. Marks: bold,
 * italic, underline, link, textSize (dropped).
 */
export interface TipTapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TipTapNode[];
}

export function parseDoc(raw: unknown): TipTapNode | null {
  if (raw && typeof raw === 'object' && (raw as TipTapNode).type === 'doc') return raw as TipTapNode;
  if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as TipTapNode;
    return parsed?.type === 'doc' ? parsed : null;
  } catch {
    return null;
  }
}

/** Personalisation tokens keep their template label, for example `{{ first_name }}`. */
function nodeText(node: TipTapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'personalisation') return String(node.attrs?.['label'] ?? '');
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(nodeText).join('');
  return node.type === 'paragraph' || node.type === 'listItem' ? `${inner}\n` : inner;
}

export function docToText(doc: TipTapNode): string {
  return nodeText(doc).replace(/\n+$/, '').trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(node: TipTapNode): string {
  if (node.type === 'hardBreak') return '<br>';
  let html = '';
  if (node.type === 'text') html = escapeHtml(node.text ?? '');
  else if (node.type === 'personalisation') html = escapeHtml(String(node.attrs?.['label'] ?? ''));
  else return (node.content ?? []).map(inline).join('');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`;
    else if (mark.type === 'italic') html = `<em>${html}</em>`;
    else if (mark.type === 'underline') html = `<u>${html}</u>`;
    else if (mark.type === 'link') {
      const href = String(mark.attrs?.['href'] ?? '');
      if (href) html = `<a href="${escapeHtml(href)}">${html}</a>`;
    }
  }
  return html;
}

function block(node: TipTapNode): string {
  switch (node.type) {
    case 'paragraph': return `<p>${(node.content ?? []).map(inline).join('')}</p>`;
    case 'bulletList': return `<ul>${(node.content ?? []).map(block).join('')}</ul>`;
    case 'orderedList': return `<ol>${(node.content ?? []).map(block).join('')}</ol>`;
    case 'listItem': return `<li>${(node.content ?? []).map((c) => c.type === 'paragraph' ? (c.content ?? []).map(inline).join('') : block(c)).join('')}</li>`;
    default: return (node.content ?? []).map(block).join('') || inline(node);
  }
}

export function docToHtml(doc: TipTapNode): string {
  return (doc.content ?? []).map(block).join('');
}

/** True when a document carries a personalisation token the target may render literally. */
export function hasPersonalisation(doc: TipTapNode): boolean {
  if (doc.type === 'personalisation') return true;
  return (doc.content ?? []).some(hasPersonalisation);
}
