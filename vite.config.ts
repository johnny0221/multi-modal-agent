import { defineConfig } from "vite-plus";

// Vite+ handles code quality; Next.js still handles development and builds.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "react", "nextjs", "jsx-a11y"],
    ignorePatterns: [".next/**", "out/**", "build/**", "next-env.d.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
    },
  },
  fmt: {
    ignorePatterns: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
});
