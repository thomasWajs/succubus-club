import js from '@eslint/js'
import typescript from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

// Vue compiler macros (auto-available in <script setup>, not real imports).
const vueMacros = {
    defineProps: 'readonly',
    defineEmits: 'readonly',
    defineExpose: 'readonly',
    withDefaults: 'readonly',
}

// Injected at build time for cache-busting (see vite config).
const cacheBustingGlobals = {
    ATLAS_TEXTURE_HASH: 'readonly',
    ATLAS_JSON_HASH: 'readonly',
}

const browserGlobals = {
    ...globals.browser,
    ...vueMacros,
    ...cacheBustingGlobals,
    // A few browser files read process.env.NODE_ENV (Vite inlines it).
    process: 'readonly',
}

export default [
    js.configs.recommended,
    ...vue.configs['flat/recommended'],
    prettierConfig,
    {
        files: ['**/*.{ts,tsx,vue}'],

        ignores: [
            // Exclude vite config files from type-aware linting
            'vite/**/*.ts',
            // Temporarily exclude server from linting
            'src/server/**/*.ts',
        ],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: typescriptParser,
                ecmaVersion: 2023,
                sourceType: 'module',
                project: './tsconfig.json',
                extraFileExtensions: ['.vue'],
            },
            globals: browserGlobals,
        },
        plugins: {
            '@typescript-eslint': typescript,
            vue: vue,
        },
        rules: {
            // TypeScript recommended rules
            ...typescript.configs.recommended.rules,

            // Disable all indentation rules - let Prettier handle formatting
            indent: 'off',
            '@typescript-eslint/indent': 'off',
            'vue/html-indent': 'off',
            'vue/script-indent': 'off',

            // Disable formatting rules that conflict with Prettier
            'vue/html-closing-bracket-newline': 'off',
            'vue/html-closing-bracket-spacing': 'off',
            'vue/max-attributes-per-line': 'off',

            // Vue-specific rules
            'vue/multi-word-component-names': 'off',
            'vue/no-v-html': 'off',
            'vue/block-order': [
                'error',
                {
                    order: ['template', 'script', 'style'],
                },
            ],
            'vue/html-self-closing': [
                'error',
                {
                    html: {
                        void: 'any',
                        normal: 'always',
                        component: 'always',
                    },
                    svg: 'always',
                    math: 'always',
                },
            ],
            'vue/attribute-hyphenation': 'off',
            'vue/require-default-prop': 'off',

            // TypeScript-specific rules
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-non-null-assertion': 'warn',

            // General JavaScript/TypeScript rules
            'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
            'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
            'prefer-const': 'error',
            'no-var': 'error',
            'object-shorthand': 'error',
            'prefer-template': 'error',

            // Allow empty object patterns for unused arguments
            'no-empty-pattern': 'off',
        },
    },
    // Separate configuration for TypeScript files (non-Vue)
    {
        files: ['**/*.{ts,tsx}'],
        ignores: [
            'vite/**/*.ts',
            '**/*.vue',
            // Temporarily exclude server from linting
            'src/server/**/*.ts',
        ],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2023,
                sourceType: 'module',
                project: './tsconfig.json',
            },
            globals: browserGlobals,
        },
        plugins: {
            '@typescript-eslint': typescript,
        },
        rules: {
            // TypeScript recommended rules
            ...typescript.configs.recommended.rules,

            // Disable indentation rules - let Prettier handle experimental ternaries
            indent: 'off',
            '@typescript-eslint/indent': 'off',

            // TypeScript-specific rules
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-non-null-assertion': 'warn',

            // General JavaScript/TypeScript rules
            'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
            'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
            'prefer-const': 'error',
            'no-var': 'error',
            'object-shorthand': 'error',
            'prefer-template': 'error',

            // Allow empty object patterns for unused arguments
            'no-empty-pattern': 'off',

            'import/group-exports': 'off',
        },
    },
    // Configuration for API files (Node.js/server-side)
    {
        files: ['api/**/*.js', 'api/**/*.mjs', 'api/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            // Disable indentation rules
            indent: 'off',

            // Allow console usage in API files
            'no-console': 'off',
            'no-undef': 'error',
            'prefer-const': 'error',
            'no-var': 'error',

            'import/group-exports': 'off',
        },
    },
    // Configuration for Node.js config files (including TypeScript config files)
    {
        files: [
            '*.config.js',
            '*.config.mjs',
            '*.config.ts',
            'eslint.config.js',
            'vite/*.js',
            'vite/*.mjs',
            'vite/*.ts',
            'vite/**/*.js',
            'vite/**/*.mjs',
            'vite/**/*.ts',
        ],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2023,
                sourceType: 'module',
                // No project reference for config files
            },
            globals: globals.node,
        },
        plugins: {
            '@typescript-eslint': typescript,
        },
        rules: {
            // Disable indentation rules
            indent: 'off',
            '@typescript-eslint/indent': 'off',

            // Allow console and process usage in config files
            'no-console': 'off',
            'no-undef': 'error',

            // Basic TypeScript rules without type-checking
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
    // Configuration for Node.js dev/tooling scripts
    {
        files: ['script/**/*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            'no-console': 'off',
            'no-undef': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', '.venv/**'],
    },
]
