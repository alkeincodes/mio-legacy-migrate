import { describe, expect, it } from 'vitest';
import { docToHtml, docToText, hasPersonalisation, parseDoc } from '../../src/map/tiptap.js';

const doc = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Welcome, ' }, { type: 'personalisation', attrs: { label: '{{ first_name }}' } }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://x.example.com' } }, { type: 'textSize', attrs: { size: 'lg' } }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
  ],
});

describe('tiptap', () => {
  it('parses a serialised document and rejects plain strings', () => {
    expect(parseDoc(doc)?.type).toBe('doc');
    expect(parseDoc('just text')).toBeNull();
    expect(parseDoc(null)).toBeNull();
  });

  it('renders plain text with the personalisation label kept', () => {
    expect(docToText(parseDoc(doc)!)).toBe('Welcome, {{ first_name }}\nBold\nlink\none');
  });

  it('renders minimal HTML with bold, links and lists, dropping textSize', () => {
    expect(docToHtml(parseDoc(doc)!)).toBe(
      '<p>Welcome, {{ first_name }}</p><p><strong>Bold</strong><br><a href="https://x.example.com">link</a></p><ul><li>one</li></ul>',
    );
  });

  it('detects personalisation tokens', () => {
    expect(hasPersonalisation(parseDoc(doc)!)).toBe(true);
    expect(hasPersonalisation(parseDoc(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }))!)).toBe(false);
  });
});
