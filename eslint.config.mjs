import tsParser from '@typescript-eslint/parser'

const config = [
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: false,
      },
    },
    rules: {},
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".next/**",
      "out/**",
      "build/**",
      "app/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
