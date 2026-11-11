// Slicer-blend view of the toolpath check. Not wired into the app.
//
// Baked colours and the Fine blend profile do not paint reels into the model: they
// leave the model painted with blend numbers and write each blend's layer pattern into
// the slicer's blend table. So the model-aware check has to ask a different question:
// on the visible outer wall of each blend, does the slicer use the reel the pattern
// names for that layer?
//
// The slicer counts layers from some first layer of its own. Rather than assume which,
// every possible starting offset of a pattern is tried and the best is reported. A
// pattern the slicer honours matches almost completely at one offset; one it ignores
// matches at none.
//
// A toolpath check only shows where the slicer puts each reel. It says nothing about
// the colour of a printed part.

/** Blend number -> its row, for every enabled row of a Snapmaker Orca project's blend table. */
export function blendPatterns(cfg) {
  const physical = (cfg.filament_colour || []).length, out = new Map();
  let next = physical + 1;
  for (const row of String(cfg.mixed_filament_definitions || '').split(';').filter(Boolean)) {
    const tokens = row.split(',');
    if (tokens[2] !== '1' || tokens.includes('d1')) continue;
    const at = tokens.indexOf('cm1'), groups = at < 0 ? [] : tokens.slice(at + 1).filter(t => /^[1-9]+$/.test(t));
    const digits = text => [...text].map(Number);
    out.set(next, groups.length
      ? { kind: 'pattern', outer: digits(groups[0]), inner: groups[1] ? digits(groups[1]) : null, row }
      : { kind: 'ratio', a: Number(tokens[0]), b: Number(tokens[1]), percent: Number(tokens[4]), row });
    next += 1;
  }
  return { physical, blends: out };
}

/** Collects, per blend and layer, how much visible outer wall each tool printed. */
export function blendTally(physical) {
  const data = new Map();
  return {
    data,
    add(layer, { kind, length, tool, reel }) {
      if (!(reel > physical) || (kind !== 'matched' && kind !== 'wrong')) return;
      const layers = data.get(reel) || data.set(reel, new Map()).get(reel);
      const tools = layers.get(layer) || layers.set(layer, {}).get(layer);
      tools[tool] = (tools[tool] || 0) + length;
    },
  };
}

/** Judge each blend. A pattern blend passes at `pass` (default 99%) of its judged wall at its best offset. */
export function judgeBlends(tally, { blends }, { pass = 0.99, minimum = 20 } = {}) {
  const results = [];
  for (const [id, blend] of blends) {
    const layers = tally.get(id) || new Map();
    let total = 0; const byTool = {};
    for (const tools of layers.values()) for (const [tool, mm] of Object.entries(tools)) { total += mm; byTool[Number(tool) + 1] = (byTool[Number(tool) + 1] || 0) + mm; }
    const shares = Object.fromEntries(Object.entries(byTool).map(([reel, mm]) => [reel, total ? mm / total : 0]));
    if (blend.kind !== 'pattern') { results.push({ blend: id, kind: 'ratio', judged: total, reelShares: shares, expected: { [blend.a]: 1 - blend.percent / 100, [blend.b]: blend.percent / 100 }, pass: null }); continue; }
    const n = blend.outer.length; let best = { offset: 0, matched: -1 };
    for (let offset = 0; offset < n; offset += 1) {
      let matched = 0;
      for (const [layer, tools] of layers) matched += tools[blend.outer[((layer + offset) % n + n) % n] - 1] || 0;
      if (matched > best.matched) best = { offset, matched };
    }
    const share = total ? best.matched / total : 0;
    results.push({ blend: id, kind: 'pattern', pattern: blend.outer.join(''), judged: total, layers: layers.size, offset: best.offset, matchedShare: share, reelShares: shares,
      pass: total < minimum ? null : share >= pass });
  }
  const judged = results.filter(r => r.kind === 'pattern' && r.pass !== null);
  return { results, pass: judged.length > 0 && judged.every(r => r.pass), judgedBlends: judged.length };
}
