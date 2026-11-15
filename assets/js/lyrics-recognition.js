(function () {
    'use strict';

    class UAMSLyricsRecognition {
        constructor() {
            this.recognizer = null;
            this.ready = false;
        }

        async initialize(options) {
            options = options || {};

            if (typeof options.recognizer !== 'function') {
                throw new Error(
                    'Для розпізнавання співу потрібен підключений модуль Whisper або інший сумісний розпізнавач.'
                );
            }

            this.recognizer = options.recognizer;
            this.ready = true;

            return true;
        }

        async recognize(audioBuffer, options) {
            if (!this.ready || !this.recognizer) {
                throw new Error(
                    'Модель розпізнавання співу не підключена.'
                );
            }

            if (!audioBuffer) {
                throw new Error('Немає аудіоданих для розпізнавання.');
            }

            options = options || {};

            const result = await this.recognizer(
                audioBuffer,
                {
                    language: options.language || 'auto',
                    task: 'transcribe'
                }
            );

            if (!result || typeof result.text !== 'string') {
                throw new Error(
                    'Модель не повернула текст розпізнавання.'
                );
            }

            return {
                text: result.text,
                segments: Array.isArray(result.segments)
                    ? result.segments
                    : []
            };
        }

        isReady() {
            return this.ready;
        }
    }

    window.UAMSLyricsRecognition = UAMSLyricsRecognition;
})();
