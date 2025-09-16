import js from '@eslint/js'
import typescript from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-plugin-prettier'
import prettierConfig from 'eslint-config-prettier'

export default [
    js.configs.recommended,
    ...vue.configs['flat/recommended'],
    prettierConfig,
    {
        files: ['**/*.{ts,tsx,vue}'],
        ignores: ['vite/**/*.ts'], // Exclude vite config files from type-aware linting
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: typescriptParser,
                ecmaVersion: 2023,
                sourceType: 'module',
                project: './tsconfig.json',
                extraFileExtensions: ['.vue'],
            },
            globals: {
                defineProps: 'readonly',
                defineEmits: 'readonly',
                defineExpose: 'readonly',
                withDefaults: 'readonly',
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                fetch: 'readonly',
                crypto: 'readonly',
                Image: 'readonly',
                screen: 'readonly',
                // Node globals
                process: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                localStorage: 'readonly',
                // Cache-busting globals
                ATLAS_TEXTURE_HASH: 'readonly',
                ATLAS_JSON_HASH: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': typescript,
            vue: vue,
            prettier: prettier,
        },
        rules: {
            // TypeScript recommended rules
            ...typescript.configs.recommended.rules,

            // Prettier integration
            'prettier/prettier': 'error',

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
        ignores: ['vite/**/*.ts', '**/*.vue'],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2023,
                sourceType: 'module',
                project: './tsconfig.json',
            },
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                fetch: 'readonly',
                // Node globals
                process: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                // Cache-busting globals
                ATLAS_TEXTURE_HASH: 'readonly',
                ATLAS_JSON_HASH: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': typescript,
            prettier: prettier,
        },
        rules: {
            // TypeScript recommended rules
            ...typescript.configs.recommended.rules,

            // Prettier integration
            'prettier/prettier': 'error',

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
        },
    },
    // Configuration for API files (Node.js/server-side)
    {
        files: ['api/**/*.js', 'api/**/*.mjs', 'api/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                // Node.js globals
                process: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                // Modern Node.js/Web API globals
                fetch: 'readonly',
                Response: 'readonly',
                Request: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
            },
        },
        plugins: {
            prettier: prettier,
        },
        rules: {
            // Prettier integration
            'prettier/prettier': 'error',

            // Disable indentation rules
            indent: 'off',

            // Allow console usage in API files
            'no-console': 'off',
            'no-undef': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
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
            globals: {
                process: 'readonly',
                Buffer: 'readonly',
                global: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': typescript,
            prettier: prettier,
        },
        rules: {
            // Prettier integration
            'prettier/prettier': 'error',

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
    {
        ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', '.venv/**'],
    },
]
