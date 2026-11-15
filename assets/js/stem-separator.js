(function () {
    'use strict';

    class UAMSStemSeparator {
        constructor() {
            this.session = null;
            this.modelUrl = '';
            this.runtime = null;
            this.ready = false;
        }

        async initialize(options) {
            options = options || {};

            if (!options.modelUrl) {
                throw new Error(
                    'Не вказано адресу AI-моделі для розділення аудіо.'
                );
            }

            if (!window.ort || !window.ort.InferenceSession) {
                throw new Error(
                    'Не підключено ONNX Runtime Web. Спочатку потрібно додати runtime.'
                );
            }

            this.runtime = window.ort;
            this.modelUrl = options.modelUrl;

            this.session = await this.runtime.InferenceSession.create(
                this.modelUrl,
                {
                    executionProviders: ['wasm']
                }
            );

            this.ready = true;

            return true;
        }

        async separate(audioBuffer, stems) {
            if (!this.ready || !this.session) {
                throw new Error(
                    'AI-модель розділення не завантажена. Розділення вокалу та інструментів поки недоступне.'
                );
            }

            if (!audioBuffer) {
                throw new Error('Немає аудіоданих.');
            }

            /*
             * Важливо:
             * Різні ONNX-моделі мають різні назви входів,
             * виходів, частоти дискретизації та формати тензорів.
             * Для реальної роботи тут потрібен адаптер конкретної
             * моделі, наприклад HTDemucs, із STFT/ISTFT,
             * нормалізацією, сегментацією та об'єднанням фрагментів.
             *
             * Не можна передати довільний AudioBuffer у модель
             * і вважати результат правильним.
             */

            throw new Error(
                'Runtime підключено, але адаптер конкретної моделі ще не налаштований. Неможливо безпечно визначити формат її входів і виходів автоматично.'
            );
        }

        isReady() {
            return this.ready;
        }
    }

    window.UAMSStemSeparator = UAMSStemSeparator;
})();
