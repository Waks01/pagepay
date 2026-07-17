# Client Security Tooling

This directory uses `eslint-plugin-security` to catch common JS/TS
security issues during `npm run lint`.

## One-time setup (developer machine)

```bash
cd client
npm install --save-dev eslint-plugin-security
```

This adds the package to `devDependencies` so CI can install it via
`npm ci` without an extra step. The eslint config in
`client/eslint.config.js` is already wired to use it.

## Rules enabled (all from `recommended` config)

- `security/detect-child-process` — flags `child_process.exec` etc.
- `security/detect-eval-with-expression` — flags `eval()` / `new Function()`.
- `security/detect-non-literal-fs-filename` — warns on dynamic fs paths.
- `security/detect-non-literal-regexp` — warns on dynamic RegExp (ReDoS).
- `security/detect-non-literal-require` — warns on dynamic `require()`.
- `security/detect-object-injection` — **disabled** (too noisy on React state).
- `security/detect-possible-timing-attacks` — flags `===` / `!==` on security-sensitive strings (use `crypto.timingSafeEqual`).
- `security/detect-unsafe-regex` — flags catastrophic backtracking patterns.

## Running

```bash
cd client
npm run lint   # already wired in your package.json
```

To run just security rules:

```bash
npx eslint --rule '{"security/*": "error"}' --no-eslintrc -c eslint.config.js .
```

## Ignoring a finding

In the rare case a finding is a false positive, suppress inline:

```ts
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.readFile(userProvidedPath);
```

Document the suppression in the PR with a one-line justification.
