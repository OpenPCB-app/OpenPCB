import { defineConfig } from 'orval';

export default defineConfig({
    OneMind: {
        input: './openapi.json',
        output: {
            mode: 'tags-split',
            target: './src-ts/shared/sdk/generated/api.ts',
            schemas: './src-ts/shared/sdk/generated/models',
            client: 'fetch',
            clean: true,
            override: {
                mutator: {
                    path: './src-ts/shared/sdk/mutator.ts',
                    name: 'customFetch',
                },
            },
        },
    },
});
