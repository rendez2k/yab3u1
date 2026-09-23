// The painted-triangle bitstream, shared with u1paint.py.
//
// Two bits say how many of the triangle's sides the paint splits. With zero
// sides the node is a leaf and the next field is the material state; with one to
// three sides the next two bits are the node's *special side* -- geometry
// metadata recording where the cut runs, never a filament -- followed by the
// children. Only a leaf names a material, which is why a remap rewrites leaves
// and copies the split metadata through bit for bit.
//
// A state of 0 means "no override" (the object's own filament) and is never
// remapped. States above SUPPORTED_STATE_MAX are refused rather than rewritten:
// newer Prusa-format files reuse the escape marker for a longer encoding, so a
// value in that range means different things to different readers.

const HEX_RE = /^[0-9A-Fa-f]*$/;

export const SUPPORTED_STATE_MAX = 16;

export class PaintError extends Error {}

export function hexToBits(text) {
  if (!text || !HEX_RE.test(text)) return [];
  const value = BigInt("0x" + text);
  const bits = [];
  for (let i = 0; i < text.length * 4; i += 1) {
    bits.push(Number((value >> BigInt(i)) & 1n));
  }
  return bits;
}

export function bitsToHex(bits) {
  let value = 0n;
  bits.forEach((bit, index) => {
    if (bit) value |= 1n << BigInt(index);
  });
  const digits = Math.max(1, Math.ceil(bits.length / 4));
  return value.toString(16).toUpperCase().padStart(digits, "0");
}

function readState(bits, i, end) {
  if (i + 2 > end) throw new PaintError("paint stream ends inside a state field");
  const code = bits[i] | (bits[i + 1] << 1);
  i += 2;
  if (code !== 3) return [code, i];
  if (i + 4 > end) throw new PaintError("paint stream ends inside an escaped state");
  let nibble = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3);
  i += 4;
  if (nibble !== 0xF) return [3 + nibble, i];
  if (i + 4 > end) {
    throw new PaintError("paint stream ends inside a two-nibble state");
  }
  nibble = bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2) | (bits[i + 3] << 3);
  i += 4;
  return [18 + nibble, i];
}

function writeState(state) {
  if (state < 0) throw new PaintError(`negative paint state ${state}`);
  if (state < 3) return [state & 1, (state >> 1) & 1];
  if (state < 18) {
    const value = state - 3;
    return [1, 1, ...[0, 1, 2, 3].map((k) => (value >> k) & 1)];
  }
  if (state < 34) {
    const value = state - 18;
    return [1, 1, 1, 1, 1, 1, ...[0, 1, 2, 3].map((k) => (value >> k) & 1)];
  }
  throw new PaintError(`paint state ${state} is beyond the format's range`);
}

function decodeNode(bits, i, end, depth) {
  if (depth > 12) throw new PaintError("paint stream nests deeper than the format allows");
  if (i + 2 > end) throw new PaintError("paint stream ends inside a split count");
  const sides = bits[i] | (bits[i + 1] << 1);
  i += 2;
  if (sides === 0) {
    const [state, next] = readState(bits, i, end);
    return [{ kind: "leaf", state }, next];
  }
  if (i + 2 > end) throw new PaintError("paint stream ends inside a special side");
  const specialSide = bits[i] | (bits[i + 1] << 1);
  i += 2;
  const children = [];
  for (let child = 0; child < sides + 1; child += 1) {
    const [node, next] = decodeNode(bits, i, end, depth + 1);
    children.push(node);
    i = next;
  }
  return [{ kind: "split", sides, specialSide, children }, i];
}

function encodeNode(node) {
  if (node.kind === "leaf") return [0, 0, ...writeState(node.state)];
  if (node.kind !== "split") throw new PaintError(`unknown paint node ${node.kind}`);
  const { sides, specialSide } = node;
  if (![1, 2, 3].includes(sides)) {
    throw new PaintError(`a node cannot split ${sides} sides`);
  }
  if (![0, 1, 2, 3].includes(specialSide)) {
    throw new PaintError(`a special side of ${specialSide} is not two bits`);
  }
  if (node.children.length !== sides + 1) {
    throw new PaintError("split node has the wrong number of children");
  }
  const out = [sides & 1, (sides >> 1) & 1, specialSide & 1, (specialSide >> 1) & 1];
  for (const child of node.children) out.push(...encodeNode(child));
  return out;
}

export function decode(text) {
  if (!text) throw new PaintError("empty paint value");
  if (!HEX_RE.test(text)) throw new PaintError(`paint value ${text} is not hexadecimal`);
  const bits = hexToBits(text);
  const [node, used] = decodeNode(bits, 0, bits.length, 0);
  if (bits.slice(used).some((bit) => bit)) {
    throw new PaintError("paint stream has non-zero bits after the last node");
  }
  return node;
}

export function encode(node) {
  return bitsToHex(encodeNode(node));
}

export function walkStates(node) {
  if (node.kind === "leaf") return [node.state];
  return node.children.flatMap(walkStates);
}

export function isSplit(text) {
  const bits = hexToBits(text);
  if (bits.length < 2) return false;
  return Boolean(bits[0] | (bits[1] << 1));
}

export function remapNode(node, mapping) {
  if (node.kind === "leaf") {
    const state = node.state;
    return { kind: "leaf",
             state: state === 0 ? 0 : (mapping[state] ?? state) };
  }
  return { kind: "split", sides: node.sides, specialSide: node.specialSide,
           children: node.children.map((child) => remapNode(child, mapping)) };
}

export function remapText(text, mapping) {
  if (!text) return text;
  const node = decode(text);
  const active = new Set(Object.keys(mapping).map(Number)
    .filter((key) => mapping[key] !== key));
  const touched = walkStates(node).some((state) => state && active.has(state));
  if (!touched) return text;
  const rewritten = encode(remapNode(node, mapping));
  decode(rewritten);                       // never write back something that moved
  return rewritten;
}

export function excessiveStates(text) {
  try {
    return [...new Set(walkStates(decode(text))
      .filter((state) => state > SUPPORTED_STATE_MAX))].sort((a, b) => a - b);
  } catch (error) {
    return [];
  }
}
