import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/openapi.generated.ts",
      "**/prisma/migrations/**",
      "**/src/generated/**",
    ],
  },
];
