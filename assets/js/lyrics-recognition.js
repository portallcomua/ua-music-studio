(function () {
    'use strict';

    class UAMSLyricsRecognition {
        async recognize(audioBuffer, options) {
            if (!audioBuffer) {
                throw new Error('Немає аудіо для розпізнавання.');
            }

            if (!window.UAMSModelLoader) {
                throw new Error('Не підключений завантажувач AI-моделей.');
            }

            const result = await window.UAMSModelLoader.transcribe(
                audioBuffer,
                options || {}
            );

            return {
                text: result.text || '',
                segments: Array.isArray(result.chunks) ? result.chunks : [],
                language: result.language || ''
            };
        }
    }

    window.UAMSLyricsRecognition = UAMSLyricsRecognition;
})();
