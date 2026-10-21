/**
 * A small LaTeX parser for the mathematics in a student's material.
 *
 * The server sends LaTeX source — `\frac{a}{b}`, `x^{2}`, `\sqrt{x}` —
 * and this file decides how it looks. That split is deliberate: the
 * same source can be typeset as a stacked fraction on a wide screen
 * and as a slashed fraction in a line of prose, and the server should
 * not have to care which.
 *
 * It handles the subset that actually turns up in school material:
 *
 *   \frac{a}{b}          a fraction
 *   \sqrt{x}  \sqrt[3]{x} a root, optionally with an index
 *   x^{2}  x_{n}  x_{n}^{2} superscripts and subscripts
 *   \alpha \sum \times …  symbols, including the Greek letters
 *   \text{words}          literal words inside an equation
 *   ^{2} _n               a script on nothing, rendered on its own
 *
 * Anything it does not understand is kept as literal text, so an
 * equation is never silently mangled. The renderer falls back to
 * showing the source in monospace when it cannot typeset something.
 */

/** One piece of a parsed equation. */
export type MathNode =
  | { kind: "text"; text: string }
  | { kind: "literal"; text: string }
  | { kind: "symbol"; text: string }
  | { kind: "frac"; numerator: MathNode[]; denominator: MathNode[] }
  | { kind: "sqrt"; radicand: MathNode[]; index?: MathNode[] }
  | { kind: "script"; base: MathNode[]; subscript?: MathNode[]; exponent?: MathNode[] }
  | { kind: "row"; children: MathNode[] };

/**
 * LaTeX commands that are just a character.
 *
 * The Greek letters and the operators a secondary-school syllabus
 * actually uses. `\,` and friends are spacing commands and produce
 * nothing.
 */
const SYMBOLS: Record<string, string> = {
  // Lowercase Greek
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
  pi: "π", varpi: "ϖ", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  // Uppercase Greek
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Operators
  times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", equiv: "≡", sim: "∼", cong: "≅",
  ll: "≪", gg: "≫", propto: "∝",
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  in: "∈", notin: "∉", subset: "⊂", supset: "⊃", subseteq: "⊆",
  supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅",
  therefore: "∴", because: "∵", angle: "∠", degree: "°",
  prime: "′", ellipsis: "…", ldots: "…", cdots: "⋯", vdots: "⋮",
  sum: "∑", prod: "∏", int: "∫", oint: "∮", sqrt: "√",
  // Arrows and relations
  rightarrow: "→", to: "→", leftarrow: "←", gets: "←",
  leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
  Leftrightarrow: "⇔", mapsto: "↦",
  // Punctuation that LaTeX escapes
  percent: "%", dollar: "$", ampersand: "&", underscore: "_", hash: "#",
  lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]", vert: "|",
  lvert: "|", rvert: "|", parallel: "∥",
  // Spacing commands. A thin space is the one worth keeping; the
  // others are dropped rather than guessed at.
  space: " ", quad: " ", qquad: " ", thinspace: " ",
  ",": " ", ":": " ", ";": " ", "!": " ",
};

/** Commands whose argument is set in ordinary words, not variables. */
const TEXT_COMMANDS = new Set([
  "text", "mathrm", "mathbf", "mathit", "operatorname", "mathsf",
  "textbf", "textit", "textrm",
]);

/** Commands that are dropped entirely — spacing and sizing. */
const IGNORED_COMMANDS = new Set([
  "left", "right", "displaystyle", "textstyle", "limits", "nolimits",
  "big", "Big", "bigg", "Bigg", "qquad", "quad", "thinspace",
]);

function isLetter(ch: string): boolean {
  return /[a-zA-Z]/.test(ch);
}

/** Join parsed pieces back into one string. */
function flattenToText(nodes: MathNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "literal":
        case "symbol":
          return node.text;
        case "row":
          return flattenToText(node.children);
        case "frac":
          return `${flattenToText(node.numerator)}/${flattenToText(node.denominator)}`;
        case "sqrt":
          return `√${flattenToText(node.radicand)}`;
        case "script":
          return flattenToText(node.base);
        default:
          return "";
      }
    })
    .join("");
}

class LatexParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): MathNode[] {
    return this.parseSequence();
  }

  /** Read atoms until `stop` (a closing brace or bracket) or the end. */
  private parseSequence(stop?: "}" | "]"): MathNode[] {
    const nodes: MathNode[] = [];

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (stop === "}" && ch === "}") break;
      if (stop === "]" && ch === "]") break;

      if (ch === "^" || ch === "_") {
        // A script with nothing to attach to. It is kept rather than
        // dropped, so "x^2 + _1" still shows the stray marker.
        nodes.push(this.parseScript(ch));
        continue;
      }

      const atom = this.parseAtom();
      if (!atom) continue;

      // A script belongs to the atom just before it: `x^{2}` is x
      // squared, not x followed by a stray exponent. Both a subscript
      // and a superscript may follow the same atom.
      let subscript: MathNode[] | undefined;
      let exponent: MathNode[] | undefined;
      while (this.pos < this.src.length) {
        const c = this.src[this.pos];
        if (c === "^" && !exponent) {
          this.pos += 1;
          exponent = this.parseGroup();
        } else if (c === "_" && !subscript) {
          this.pos += 1;
          subscript = this.parseGroup();
        } else {
          break;
        }
      }

      if (subscript || exponent) {
        const base = atom.kind === "row" ? atom.children : [atom];
        nodes.push({ kind: "script", base, subscript, exponent });
      } else {
        nodes.push(atom);
      }
    }

    return nodes;
  }

  /** Read a `{...}` group or a single character. */
  private parseGroup(): MathNode[] {
    // A space between a command and its argument is not part of it.
    while (this.src[this.pos] === " ") this.pos += 1;

    if (this.src[this.pos] === "{") {
      this.pos += 1;
      const body = this.parseSequence("}");
      if (this.src[this.pos] === "}") this.pos += 1;
      return body;
    }
    const atom = this.parseAtom();
    return atom ? [atom] : [];
  }

  /** Read one atom: a command, a group, or a run of ordinary text. */
  private parseAtom(): MathNode | null {
    const ch = this.src[this.pos];
    if (ch === undefined) return null;

    if (ch === "\\") return this.parseCommand();

    if (ch === "{") {
      this.pos += 1;
      const body = this.parseSequence("}");
      if (this.src[this.pos] === "}") this.pos += 1;
      return { kind: "row", children: body };
    }

    // A run of ordinary characters, so "abc" is one text node rather
    // than three.
    let text = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === "\\" || c === "^" || c === "_" || c === "{" || c === "}") break;
      text += c;
      this.pos += 1;
    }
    if (!text) {
      // A character we cannot consume — step over it so the parser
      // cannot loop forever.
      this.pos += 1;
      return { kind: "text", text: ch };
    }
    return { kind: "text", text };
  }

  /** Read a superscript or subscript and its argument. */
  private parseScript(kind: "^" | "_"): MathNode {
    this.pos += 1; // consume ^ or _
    const argument = this.parseGroup();
    return {
      kind: "script",
      base: [],
      ...(kind === "^" ? { exponent: argument } : { subscript: argument }),
    };
  }

  /** Read a `\command` and whatever it takes. */
  private parseCommand(): MathNode | null {
    this.pos += 1; // consume the backslash
    if (this.pos >= this.src.length) {
      return { kind: "text", text: "\\" };
    }

    // A control character such as `\{` or `\%`.
    if (!isLetter(this.src[this.pos])) {
      const ch = this.src[this.pos];
      this.pos += 1;
      if (ch === "{") return { kind: "text", text: "{" };
      if (ch === "}") return { kind: "text", text: "}" };
      if (ch === "\\") return { kind: "text", text: "\\\\" };
      return { kind: "text", text: SYMBOLS[ch] ?? ch };
    }

    let name = "";
    while (this.pos < this.src.length && isLetter(this.src[this.pos])) {
      name += this.src[this.pos];
      this.pos += 1;
    }
    // The space after a control word is not swallowed. LaTeX drops it,
    // but a reader of a phone screen is better served by "2 × 3" than
    // by "2×3", and the source was written with the space in mind.

    if (IGNORED_COMMANDS.has(name)) {
      // `\left(` — the delimiter that follows is still meaningful.
      if (name === "left" || name === "right") {
        const delimiter = this.src[this.pos];
        if (delimiter && !isLetter(delimiter) && delimiter !== "\\") {
          this.pos += 1;
          return { kind: "text", text: delimiter === "." ? "" : delimiter };
        }
      }
      return null;
    }

    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const numerator = this.parseGroup();
      const denominator = this.parseGroup();
      return { kind: "frac", numerator, denominator };
    }

    if (name === "sqrt") {
      let index: MathNode[] | undefined;
      if (this.src[this.pos] === "[") {
        this.pos += 1;
        index = this.parseSequence("]");
        if (this.src[this.pos] === "]") this.pos += 1;
      }
      const radicand = this.parseGroup();
      return { kind: "sqrt", radicand, index };
    }

    if (TEXT_COMMANDS.has(name)) {
      // Words inside an equation are set in ordinary type, not as
      // variables, so they are marked literal and never italicised.
      const body = this.parseGroup();
      return { kind: "literal", text: flattenToText(body) };
    }

    const symbol = SYMBOLS[name];
    if (symbol !== undefined) {
      return { kind: "symbol", text: symbol };
    }

    // An unknown command. Keep its name so nothing is lost — a reader
    // seeing `\unknowncmd` can tell something was there.
    return { kind: "text", text: `\\${name}` };
  }
}

/** Parse a LaTeX string into renderable pieces. */
export function parseLatex(source: string): MathNode[] {
  if (!source) return [];
  return new LatexParser(source).parse();
}

/**
 * Flatten a parsed equation to plain text.
 *
 * Used for the fallback rendering, for accessibility labels, and for
 * the narration — a voice cannot read a stacked fraction, so the
 * spoken form says "a over b".
 */
export function mathNodesToPlainText(nodes: MathNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "literal":
        case "symbol":
          return node.text;
        case "frac":
          return `${mathNodesToPlainText(node.numerator)} over ${mathNodesToPlainText(
            node.denominator,
          )}`;
        case "sqrt": {
          const index = node.index
            ? `${mathNodesToPlainText(node.index)} root of `
            : "the square root of ";
          return `${index}${mathNodesToPlainText(node.radicand)}`;
        }
        case "script": {
          const base = mathNodesToPlainText(node.base);
          const sub = node.subscript
            ? ` subscript ${mathNodesToPlainText(node.subscript)}`
            : "";
          const sup = node.exponent
            ? ` to the power ${mathNodesToPlainText(node.exponent)}`
            : "";
          return `${base}${sub}${sup}`;
        }
        case "row":
          return mathNodesToPlainText(node.children);
        default:
          return "";
      }
    })
    .join("");
}

/** The plain-text form of an equation. */
export function latexToPlainText(source: string): string {
  return mathNodesToPlainText(parseLatex(source));
}

/**
 * Does this run between two dollar signs look like mathematics?
 *
 * A dollar sign is also a currency symbol, so "it costs $5 and $10"
 * must not turn into an equation. A run counts as mathematics when it
 * carries a LaTeX command, a superscript or a subscript, or when it is
 * short and unbroken — which is what an inline formula looks like.
 */
function looksLikeMath(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\\")) return true;
  if (trimmed.includes("^") || trimmed.includes("_")) return true;
  if (/\s/.test(trimmed)) return false;
  return trimmed.length <= 24;
}

/**
 * Split a line of prose into plain text and inline mathematics.
 *
 * `$x^{2} + y^{2} = z^{2}$` becomes a text run, a maths run and a text
 * run. A dollar sign that is not wrapping mathematics is treated as a
 * literal character so a price or a currency amount does not break the
 * line.
 */
export function splitInlineMath(
  text: string,
): Array<{ kind: "text" | "math"; value: string }> {
  const parts: Array<{ kind: "text" | "math"; value: string }> = [];
  let buffer = "";
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf("$", index);
    if (open === -1) {
      buffer += text.slice(index);
      break;
    }
    const close = text.indexOf("$", open + 1);
    if (close === -1) {
      buffer += text.slice(index);
      break;
    }
    const inner = text.slice(open + 1, close);
    // A pair that spans a newline is not mathematics.
    if (inner.includes("\n") || !looksLikeMath(inner)) {
      buffer += text.slice(index, close + 1);
      index = close + 1;
      continue;
    }
    buffer += text.slice(index, open);
    if (buffer) parts.push({ kind: "text", value: buffer });
    buffer = "";
    parts.push({ kind: "math", value: inner });
    index = close + 1;
  }

  if (buffer) parts.push({ kind: "text", value: buffer });
  return parts;
}
