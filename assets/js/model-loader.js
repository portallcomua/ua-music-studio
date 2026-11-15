(function (window) {
    'use strict';

    const UAMSModelLoader = {
        transformers: null,
        ort: null,
        whisperPipeline: null,
        translationPipeline: null,
        loading: {},

        async loadTransformers() {
            if (this.transformers) return this.transformers;
            if (!this.loading.transformers) {
                this.loading.transformers = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2');
            }
            this.transformers = await this.loading.transformers;
            return this.transformers;
        },

        async loadWhisper(progressCallback) {
            if (this.whisperPipeline) return this.whisperPipeline;

            const transformers = await this.loadTransformers();
            this.whisperPipeline = await transformers.pipeline(
                'automatic-speech-recognition',
                'onnx-community/whisper-tiny',
                {
                    device: 'wasm',
                    dtype: 'q8',
                    progress_callback: progressCallback || function () {}
                }
            );
            return this.whisperPipeline;
        },

        async loadTranslation(progressCallback) {
            if (this.translationPipeline) return this.translationPipeline;

            const transformers = await this.loadTransformers();
            this.translationPipeline = await transformers.pipeline(
                'translation',
                'Xenova/opus-mt-en-uk',
                {
                    device: 'wasm',
                    dtype: 'q8',
                    progress_callback: progressCallback || function () {}
                }
            );
            return this.translationPipeline;
        },

        async loadONNX(progressCallback) {
            if (this.ort) return this.ort;

            this.ort = await import(
                'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.mjs'
            );

            this.ort.env.wasm.wasmPaths =
                'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';

            this.ort.env.wasm.numThreads = Math.max(
                1,
                Math.min(4, (navigator.hardwareConcurrency || 2) - 1)
            );

            if (progressCallback) progressCallback({
                status: 'ready',
                progress: 100
            });

            return this.ort;
        },

        async createDemucsSession(modelUrl, progressCallback) {
            const ort = await this.loadONNX(progressCallback);

            return ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                enableCpuMemArena: true,
                enableMemPattern: true
            });
        },

        async transcribe(audio, options) {
            const recognizer = await this.loadWhisper(
                options && options.progress
            );

            const result = await recognizer(audio, {
                return_timestamps: 'chunk',
                chunk_length_s: 20,
                stride_length_s: 5,
                ...((options && options.language) ? {
                    language: options.language
                } : {})
            });

            return result;
        },

        async translate(text, options) {
            const translator = await this.loadTranslation(
                options && options.progress
            );

            const result = await translator(text, {
                max_new_tokens: 512
            });

            if (Array.isArray(result) && result[0]) {
                return result[0].translation_text || '';
            }

            return '';
        },

        clear() {
            this.whisperPipeline = null;
            this.translationPipeline = null;
            this.transformers = null;
            this.ort = null;
            this.loading = {};
        }
    };

    window.UAMSModelLoader = UAMSModelLoader;
})(window);
