import js from "@eslint/js";
import globals from "globals";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unicorn from "eslint-plugin-unicorn";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";
import tikz from "./scripts/eslint-plugin-tikz.mjs";

export default tseslint.config(
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error"
    }
  },
  {
    ignores: [
      "node_modules/**",
      ".local-notes/**",
      "**/dist/**",
      "dist/**",
      "packages/core/dist/**",
      "apps/web/dist/**",
      "apps/landing/dist/**",
      "apps/desktop/dist/**",
      "apps/desktop/src-tauri/target/**",
      "packages/app/public/docs/**",
      "test/papers/**",
      "test-results/**",
      "apps/*/test-results/**",
      "apps/web/profiling/traces/**",
      "examples/**",
      "prototypes/**",
      "tikz-dev/**",
      "pgf-docs/**",
      "pgf-src/**",
      "tauri-docs/**",
      "vitest.config.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "@eslint-react": eslintReact,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      tikz,
      unicorn
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-duplicate-type-constituents": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
      "@typescript-eslint/no-unsafe-unary-minus": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "no-constant-condition": "warn",
      "no-empty": ["warn", { allowEmptyCatch: false }],
      "no-fallthrough": "error",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "warn",
      "@eslint-react/dom-no-find-dom-node": "warn",
      "@eslint-react/dom-no-missing-button-type": "warn",
      "@eslint-react/dom-no-unknown-property": "warn",
      "@eslint-react/jsx-no-children-prop": "warn",
      "@eslint-react/no-missing-key": "warn",
      "@eslint-react/no-component-will-mount": "warn",
      "@eslint-react/no-component-will-receive-props": "warn",
      "@eslint-react/no-component-will-update": "warn",
      "@eslint-react/no-unsafe-component-will-mount": "warn",
      "@eslint-react/no-unsafe-component-will-receive-props": "warn",
      "@eslint-react/no-unsafe-component-will-update": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "off",
      "tikz/jsx-no-duplicate-props": "warn"
    }
  },
  {
    files: ["test/**", "apps/web/e2e/**", "apps/web/profiling/**", "apps/desktop/e2e/**"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-unary-minus": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-parameters": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/unbound-method": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
      "@eslint-react/dom-no-find-dom-node": "error",
      "@eslint-react/dom-no-missing-button-type": "error",
      "@eslint-react/dom-no-unknown-property": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/no-component-will-mount": "error",
      "@eslint-react/no-component-will-receive-props": "error",
      "@eslint-react/no-component-will-update": "error",
      "@eslint-react/no-unsafe-component-will-mount": "error",
      "@eslint-react/no-unsafe-component-will-receive-props": "error",
      "@eslint-react/no-unsafe-component-will-update": "error",
      "tikz/jsx-no-duplicate-props": "error",
      "tikz/no-coordinate-type-cast": "error",
      "tikz/no-raw-coordinate-object": "error",
      "unicorn/catch-error-name": "error",
      "unicorn/no-new-array": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/no-useless-promise-resolve-reject": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-dom-node-remove": "error",
      "unicorn/prefer-includes": "error",
      "unicorn/prefer-number-properties": "error"
    }
  },
  {
    files: [
      "apps/desktop/src/main.tsx",
      "apps/desktop/src/vite-env.d.ts",
      "apps/landing/src/App.tsx",
      "apps/landing/src/main.tsx",
      "apps/landing/src/vite-env.d.ts",
      "apps/web/src/main.tsx",
      "apps/web/src/vite-env.d.ts",
      "packages/app/src/app-menu/**/*.{ts,tsx}",
      "packages/app/src/colors/color-palette.ts",
      "packages/app/src/context-menu/**/*.{ts,tsx}",
      "packages/app/src/edit-analysis-manager.ts",
      "packages/app/src/index.ts",
      "packages/app/src/landing-assets.ts",
      "packages/app/src/linked-file-sync.ts",
      "packages/app/src/platform/**/*.{ts,tsx}",
      "packages/app/src/profiling.ts",
      "packages/app/src/scrub-utils.ts",
      "packages/app/src/settings/**/*.{ts,tsx}",
      "packages/app/src/colors/source-color-detection.ts",
      "packages/app/src/source-identity.ts",
      "packages/app/src/store/**/*.{ts,tsx}",
      "packages/app/src/types/**/*.{ts,tsx}",
      "packages/app/src/ui/TreeView.tsx",
      "packages/app/src/ui/coords/**/*.{ts,tsx}",
      "packages/app/src/ui/source-panel/number-scrubber.ts",
      "packages/app/src/ui/source-panel/tikz-autocomplete.ts",
      "packages/core/src/ast/**/*.{ts,tsx}",
      "packages/core/src/capabilities/**/*.{ts,tsx}",
      "packages/core/src/coords/**/*.{ts,tsx}",
      "packages/core/src/corpus/**/*.{ts,tsx}",
      "packages/core/src/domains/**/*.{ts,tsx}",
      "packages/core/src/export/**/*.{ts,tsx}",
      "packages/core/src/foreach/**/*.{ts,tsx}",
      "packages/core/src/geometry/**/*.{ts,tsx}",
      "packages/core/src/index.ts",
      "packages/core/src/macros/**/*.{ts,tsx}",
      "packages/core/src/options/**/*.{ts,tsx}",
      "packages/core/src/parser/incremental.ts",
      "packages/core/src/profiling.ts",
      "packages/core/src/svg/**/*.{ts,tsx}",
      "packages/core/src/syntax/**/*.{ts,tsx}",
      "packages/core/src/text/knuth-plass/**/*.{ts,tsx}",
      "packages/core/src/types/**/*.{ts,tsx}",
      "packages/core/src/utils/**/*.{ts,tsx}"
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "error"
    }
  },
  {
    files: ["test/**/*.{ts,tsx}"],
    plugins: {
      vitest
    },
    rules: {
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "warn",
      "vitest/no-identical-title": "warn",
      "vitest/no-commented-out-tests": "warn",
      "vitest/no-conditional-tests": "warn"
    }
  },
  {
    files: [
      "packages/app/src/ui/canvas-panel/**/*.{ts,tsx}",
      "packages/app/src/ui/inspector-panel/**/*.{ts,tsx}"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "no-useless-assignment": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  }
);
