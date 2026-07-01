// eslint.config.js — flat config for the client (react/browser) and server (node).
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

const common = {
  "no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "no-empty": ["error", { allowEmptyCatch: true }], // intentional empty catches are fine
  curly: ["error", "all"], // braces on every block (house style: option 3)
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "client/test/.tmp/**",
      "server/data/**",
      "**/*.timestamp-*.mjs",
    ],
  },
  js.configs.recommended,

  // client — react components, browser globals
  {
    files: ["client/src/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error", // count components referenced only in JSX as used
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      ...common,
    },
  },

  // client tests — node + browser (jsdom stubs document/window)
  {
    files: ["client/test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { ...common },
  },

  // server + config files — node globals
  {
    files: ["server/**/*.{js,mjs}", "client/*.js", "*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...common },
  },

  // service worker — worker globals (self, caches, fetch, Response, URL)
  {
    files: ["client/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.serviceworker, ...globals.browser },
    },
    rules: { ...common },
  },

  prettier, // turn off rules that conflict with prettier

  // house style: braces on every block. Re-enabled after prettier (which disables
  // curly) — safe with "all", and prettier won't fight it. Keep this last.
  { rules: { curly: ["error", "all"] } },
];
