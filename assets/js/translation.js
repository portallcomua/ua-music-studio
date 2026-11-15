(function () {
    'use strict';

    class UAMSTranslation {
        constructor() {
            this.translator = null;
            this.ready = false;
        }

        registerTranslator(translator) {
            if (typeof translator !== 'function') {
                throw new Error('Некоректний модуль перекладу.');
            }

            this.translator = translator;
            this.ready = true;
        }

        async translate(text, targetLanguage) {
            if (!text || !String(text).trim()) {
                throw new Error('Немає тексту для перекладу.');
            }

            if (!this.ready || !this.translator) {
                throw new Error(
                    'Модуль перекладу не підключений. Для перекладу українською потрібна окрема модель або сервіс.'
                );
            }

            const result = await this.translator(
                String(text),
                targetLanguage || 'uk'
            );

            if (typeof result !== 'string' || !result.trim()) {
                throw new Error('Не вдалося отримати переклад.');
            }

            return result;
        }

        isReady() {
            return this.ready;
        }
    }

    window.UAMSTranslation = UAMSTranslation;
})();
