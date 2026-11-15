(function () {
    'use strict';

    class UAMSTranslation {
        async translate(text, targetLanguage) {
            const source = String(text || '').trim();

            if (!source) {
                throw new Error('Немає тексту для перекладу.');
            }

            if (targetLanguage && targetLanguage !== 'uk') {
                throw new Error('Зараз доступний напрямок перекладу англійська → українська.');
            }

            if (!window.UAMSModelLoader) {
                throw new Error('Не підключений завантажувач AI-моделей.');
            }

            return await window.UAMSModelLoader.translate(source);
        }
    }

    window.UAMSTranslation = UAMSTranslation;
})();
