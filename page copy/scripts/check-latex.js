/**
 * Manual check for the LaTeX parser.
 *
 * The parser is the piece most likely to be subtly wrong — a fraction
 * that loses its denominator is worse than no typesetting at all — and
 * the frontend has no test runner, so this compiles the module and
 * exercises it directly.
 *
 * Run with:  node scripts/check-latex.js
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const OUT = path.join(os.tmpdir(), "pagepay-latex-check");

require("child_process").execSync(
  `npx tsc "${path.join(
    __dirname,
    "..",
    "src",
    "shared",
    "lib",
    "latex.ts",
  )}" --outDir "${OUT}" --module commonjs --target es2019 --skipLibCheck --esModuleInterop --ignoreConfig`,
  { stdio: "inherit", cwd: path.join(__dirname, "..") },
);

// A `package.json` somewhere above this directory marks .js files as
// ES modules, and the compiler emits CommonJS. Renaming the output to
// .cjs settles it.
const compiled = path.join(OUT, "latex.js");
const renamed = path.join(OUT, "latex.cjs");
fs.copyFileSync(compiled, renamed);

const {
  parseLatex,
  latexToPlainText,
  splitInlineMath,
} = require(renamed);

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
  } else {
    console.log(`ok   ${label} -> ${actual}`);
  }
}

function checkContains(label, haystack, needle) {
  const ok = String(haystack).includes(needle);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected to contain: ${needle}\n  actual: ${haystack}`);
  } else {
    console.log(`ok   ${label} -> ${haystack}`);
  }
}

// ── Symbols ───────────────────────────────────────────────────────────

check("greek letter", latexToPlainText("\\alpha"), "α");
check("sum", latexToPlainText("\\sum"), "∑");
check("times", latexToPlainText("2 \\times 3"), "2 × 3");
check("inequality", latexToPlainText("a \\leq b"), "a ≤ b");
check("infinity", latexToPlainText("\\infty"), "∞");

// ── Fractions ────────────────────────────────────────────────────────

checkContains(
  "fraction",
  latexToPlainText("\\frac{a}{b}"),
  "a over b",
);
const frac = parseLatex("\\frac{a}{b}")[0];
check("fraction kind", frac.kind, "frac");
check("fraction numerator", frac.numerator[0].text, "a");
check("fraction denominator", frac.denominator[0].text, "b");

// ── Roots ────────────────────────────────────────────────────────────

checkContains("sqrt", latexToPlainText("\\sqrt{x}"), "square root of x");
const sqrt = parseLatex("\\sqrt{2}")[0];
check("sqrt kind", sqrt.kind, "sqrt");
check("sqrt radicand", sqrt.radicand[0].text, "2");

// ── Scripts ──────────────────────────────────────────────────────────

checkContains("power", latexToPlainText("x^{2}"), "to the power 2");
checkContains("subscript", latexToPlainText("x_{n}"), "subscript n");
const script = parseLatex("x_{i}^{2}")[0];
check("script kind", script.kind, "script");
check("script base", script.base[0].text, "x");
check("script sub", script.subscript[0].text, "i");
check("script sup", script.exponent[0].text, "2");

// ── Text commands ────────────────────────────────────────────────────

check("text command", latexToPlainText("\\text{speed of light}"), "speed of light");

// ── Plain text passes through ────────────────────────────────────────

check("plain", latexToPlainText("E = mc^2"), "E = mc to the power 2");
check("unknown command is kept", latexToPlainText("\\weird"), "\\weird");

// ── Inline splitting ─────────────────────────────────────────────────

const parts = splitInlineMath("the area is $πr^{2}$ exactly");
check("split parts", parts.length, 3);
check("split kind 0", parts[0].kind, "text");
check("split kind 1", parts[1].kind, "math");
check("split math value", parts[1].value, "πr^{2}");

const currency = splitInlineMath("it costs $5 and $10");
check("lone dollar is literal", currency.length, 1);
check("lone dollar text", currency[0].value, "it costs $5 and $10");

const noMath = splitInlineMath("plain sentence");
check("no math", noMath.length, 1);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all latex checks passed");
