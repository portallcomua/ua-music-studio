(function () {
    'use strict';

    class UAMSPitchShifter {
        constructor() {
            this.processor = null;
            this.semitones = 0;
        }

        registerProcessor(processor) {
            if (typeof processor !== 'function') {
                throw new Error('Некоректний модуль транспонування.');
            }

            this.processor = processor;
        }

        async process(audioBuffer, semitones) {
            if (!audioBuffer) {
                throw new Error('Немає аудіоданих для обробки.');
            }

            const shift = Math.max(
                -12,
                Math.min(12, parseInt(semitones, 10) || 0)
            );

            this.semitones = shift;

            if (shift === 0) {
                return audioBuffer;
            }

            if (!this.processor) {
                throw new Error(
                    'Модуль якісного транспонування ще не підключений. Зміна playbackRate не використовується, оскільки вона змінює темп.'
                );
            }

            const result = await this.processor(audioBuffer, shift);

            if (!(result instanceof AudioBuffer)) {
                throw new Error('Модуль повернув некоректний аудіорезультат.');
            }

            return result;
        }

        getSemitones() {
            return this.semitones;
        }

        reset() {
            this.semitones = 0;
        }
    }

    window.UAMSPitchShifter = UAMSPitchShifter;
})();
