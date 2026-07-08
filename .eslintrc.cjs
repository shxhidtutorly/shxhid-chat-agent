/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es2022: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  rules: {
    // Regex escapes like /[-\.\/]/ are used pervasively in the search-routing
    // code; they are harmless and rewriting them is pure churn.
    "no-useless-escape": "off",
    // `catch (e) {}` fire-and-forget blocks are an established pattern here
    // (analytics, best-effort persistence).
    "no-empty": ["error", { allowEmptyCatch: true }],
    // `while (true)` agent/tool loops are intentional and bounded elsewhere.
    "no-constant-condition": ["error", { checkLoops: false }],
    // Keep unused vars visible without blocking CI on pre-existing ones.
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
        // Everything under app/ executes server-side in React Router (routes
        // included) and reads process.env; tests and scripts run under node.
        "app/**/*.{js,jsx,ts,tsx}",
        "tests/**/*.{js,ts}",
        "scripts/**/*.{js,ts}",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly"
  },
};
