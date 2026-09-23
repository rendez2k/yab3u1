// Standard 3MF colour: `m:colorgroup` resources and per-triangle colour
// references, plus the exact triangle subdivision Bambu/Prusa use to paint part
// of a facet.
//
// Bambu Studio reads a *configless* model by centring it on the user's current
// bed (Plater.cpp `center_instances_around_point`, the non-project branch) and,
// for a standard-colour model, maps the file's colour groups to the user's own
// filaments through its native colour dialog.  So this module writes colours the
// standard way and no printer/process/filament preset at all.
//
// The split geometry below is a faithful port of the algorithm, not an
// approximation: `TriangleSelector::perform_split` (Bambu/Orca), with the vertex
// rotation `verts[i] = tri[(specialSide + i) % 3]`, one child triangle per
// painted region.

export const COLOUR_NS = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";

const GROUP_RE = /<m:colorgroup\b([^>]*)>([\s\S]*?)<\/m:colorgroup>/g;
const COLOUR_RE = /<m:color\b([^>]*)\/>/g;
const HEX_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

/** The colour groups a model declares: Map<id, ["#RRGGBB", …]>. */
export function parseColourGroups(modelText) {
  const groups = new Map();
  if (!modelText) return groups;
  GROUP_RE.lastIndex = 0;
  let match;
  while ((match = GROUP_RE.exec(modelText)) !== null) {
    const id = /id="([^"]*)"/.exec(match[1]);
    if (!id) continue;
    const colours = [];
    COLOUR_RE.lastIndex = 0;
    let colour;
    while ((colour = COLOUR_RE.exec(match[2])) !== null) {
      const value = /color="([^"]*)"/.exec(colour[1]);
      if (value) colours.push(value[1]);
    }
    if (colours.length) groups.set(String(id[1]), colours);
  }
  return groups;
}

/** One `<m:colorgroup>` resource with our own hex spelling, in palette order. */
export function colourGroupXml(id, colours) {
  const body = colours.map((colour) => {
    const hex = String(colour || "#FFFFFF").toUpperCase();
    const rgba = /^#[0-9A-F]{8}$/.test(hex) ? hex : `${hex}FF`;
    return `   <m:color color="${rgba}"/>\n`;
  }).join("");
  return `  <m:colorgroup id="${id}">\n${body}  </m:colorgroup>\n`;
}

/** `#RRGGBB` from a group entry that may carry an alpha pair. */
export function colourOf(entry) {
  const hex = String(entry || "").toUpperCase();
  if (!HEX_RE.test(hex)) return null;
  return hex.slice(0, 7);
}

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * The child triangles one split node produces, in the reference's own vertex
 * order, so a child's own `specialSide` means what the file says it means.
 *
 * @param {number[][]} triangle three [x,y,z] corners, original winding
 * @param {{sides: number, specialSide: number}} node
 * @returns {number[][][]} sides + 1 child triangles
 */
export function splitChildren(triangle, node) {
  const sides = Number(node.sides);
  const special = sides === 3 ? 0 : Number(node.specialSide) % 3;
  if (![1, 2, 3].includes(sides)) {
    throw new Error(`a paint split has ${node.sides} sides, which is not 1..3`);
  }
  const v0 = triangle[special % 3];
  const v1 = triangle[(special + 1) % 3];
  const v2 = triangle[(special + 2) % 3];
  if (sides === 1) {
    // The side opposite v0 is cut: (v0, v1, m) and (m, v2, v0).
    const m = mid(v1, v2);
    return [[v0, v1, m], [m, v2, v0]];
  }
  if (sides === 2) {
    // The two sides meeting at v0 are cut: the corner, then halves of the rest.
    const a = mid(v1, v0);
    const b = mid(v0, v2);
    return [[v0, a, b], [a, v1, b], [v1, v2, b]];
  }
  // All three sides: the four-way midpoint subdivision.
  const m01 = mid(v0, v1);
  const m12 = mid(v1, v2);
  const m20 = mid(v2, v0);
  return [[v0, m01, m20], [m01, v1, m12], [m12, v2, m20], [m01, m12, m20]];
}

/**
 * Every painted leaf of one painted facet, as real triangles.
 *
 * `walk` is the decoded node tree (`paint.decode`): a leaf carries a material
 * state, a split carries `sides`, `specialSide` and `sides + 1` children.  The
 * corner points come from the source mesh, so each returned triangle is exact
 * geometry with the leaf's colour -- no dominant-colour approximation.
 */
export function leafTriangles(triangle, node) {
  if (node.kind === "leaf") return [{ triangle, state: node.state }];
  const children = splitChildren(triangle, node);
  if (children.length !== node.children.length) {
    throw new Error("a split node and its child list disagree");
  }
  const out = [];
  children.forEach((child, index) => {
    out.push(...leafTriangles(child, node.children[index]));
  });
  return out;
}
