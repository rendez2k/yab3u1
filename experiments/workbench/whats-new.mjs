// The release notes shown from the version number. The changelog is the single source:
// the build turns its newest entries into data, and the page lays them out as plain text.

/** Split `**bold**` runs out of a line; everything else stays literal text. */
export function segments(line) {
  const out = [];
  for (const part of String(line).replace(/`/g, '').split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    out.push(part.startsWith('**') && part.endsWith('**') ? { bold: true, text: part.slice(2, -2) } : { text: part });
  }
  return out;
}

/** The newest `limit` releases as [{version, title, blocks:[{kind:'p'|'li', parts}]}]. */
export function parseChangelog(text, limit = 10) {
  const releases = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd(), head = /^##\s+(\d+(?:\.\d+)+)\s*(?:[—–-]\s*(.*))?$/.exec(line);
    if (head) { if (releases.length >= limit) break; current = { version: head[1], title: (head[2] || '').trim(), blocks: [] }; releases.push(current); continue; }
    if (!current || !line.trim() || /^#/.test(line)) continue;
    const item = /^\s*[-*]\s+(.*)$/.exec(line), last = current.blocks[current.blocks.length - 1];
    if (item) current.blocks.push({ kind: 'li', parts: segments(item[1]) });
    // A wrapped line continues the block before it.
    else if (last && /^\s+\S/.test(raw)) last.parts.push(...segments(' ' + line.trim()));
    else current.blocks.push({ kind: 'p', parts: segments(line.trim()) });
  }
  return releases;
}

/** Lay the releases out in `host` using text nodes only. */
export function renderNews(host, releases, doc = host.ownerDocument) {
  host.replaceChildren();
  for (const release of releases) {
    const section = doc.createElement('section'), heading = doc.createElement('h2');
    heading.textContent = release.title ? `${release.version} · ${release.title}` : release.version;
    section.append(heading);
    let list = null;
    for (const block of release.blocks) {
      const node = doc.createElement(block.kind === 'li' ? 'li' : 'p');
      for (const part of block.parts) { const piece = part.bold ? doc.createElement('strong') : doc.createTextNode(part.text); if (part.bold) piece.textContent = part.text; node.append(piece); }
      if (block.kind === 'li') { if (!list) { list = doc.createElement('ul'); section.append(list); } list.append(node); }
      else { list = null; section.append(node); }
    }
    host.append(section);
  }
}
