import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
    test: {
        environment: "node",
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            exclude: [
                '**/*.test.ts',
                'dist/**',
                'node_modules/**'
            ]
        }
    }
});