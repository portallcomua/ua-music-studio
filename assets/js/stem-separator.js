(function () {
    'use strict';

    class UAMSStemSeparator {
        constructor() {
            this.session = null;
            this.modelUrl = '';
            this.ready = false;
            this.sampleRate = 44100;
            this.chunkSize = 343980;
            this.overlap = 0.25;
            this.names = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
        }

        async initialize(options) {
            options = options || {};

            if (this.ready && this.session) return true;

            if (!options.modelUrl) {
                throw new Error('Не вказано адресу HTDemucs 6-stem ONNX.');
            }

            if (!window.UAMSModelLoader) {
                throw new Error('Не завантажено модуль AI-моделей.');
            }

            this.modelUrl = options.modelUrl;

            if (typeof options.progress === 'function') {
                options.progress({ status: 'loading', progress: 0 });
            }

            this.session = await window.UAMSModelLoader.createDemucsSession(
                this.modelUrl,
                options.progress
            );

            if (!this.session.inputNames || !this.session.inputNames.length) {
                throw new Error('ONNX-модель не має вхідного тензора.');
            }

            if (!this.session.outputNames || !this.session.outputNames.length) {
                throw new Error('ONNX-модель не має вихідного тензора.');
            }

            this.ready = true;
            return true;
        }

        resample(input, fromRate, toRate) {
            if (fromRate === toRate) return input.slice();

            const length = Math.max(1, Math.round(input.length * toRate / fromRate));
            const output = new Float32Array(length);
            const ratio = fromRate / toRate;

            for (let i = 0; i < length; i++) {
                const position = i * ratio;
                const left = Math.floor(position);
                const right = Math.min(left + 1, input.length - 1);
                const fraction = position - left;

                output[i] =
                    (input[left] || 0) * (1 - fraction) +
                    (input[right] || 0) * fraction;
            }

            return output;
        }

        toStereo44100(buffer) {
            const left = buffer.getChannelData(0);
            const right = buffer.numberOfChannels > 1
                ? buffer.getChannelData(1)
                : left;

            return {
                left: this.resample(left, buffer.sampleRate, this.sampleRate),
                right: this.resample(right, buffer.sampleRate, this.sampleRate)
            };
        }

        makeWav(left, right, sampleRate) {
            const frames = Math.min(left.length, right.length);
            const dataSize = frames * 4;
            const output = new ArrayBuffer(44 + dataSize);
            const view = new DataView(output);

            const write = (offset, value) => {
                for (let i = 0; i < value.length; i++) {
                    view.setUint8(offset + i, value.charCodeAt(i));
                }
            };

            write(0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            write(8, 'WAVE');
            write(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 2, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 4, true);
            view.setUint16(32, 4, true);
            view.setUint16(34, 16, true);
            write(36, 'data');
            view.setUint32(40, dataSize, true);

            let offset = 44;

            for (let i = 0; i < frames; i++) {
                const l = Math.max(-1, Math.min(1, left[i] || 0));
                const r = Math.max(-1, Math.min(1, right[i] || 0));

                view.setInt16(offset, l < 0 ? l * 32768 : l * 32767, true);
                view.setInt16(offset + 2, r < 0 ? r * 32768 : r * 32767, true);
                offset += 4;
            }

            return new Blob([output], { type: 'audio/wav' });
        }

        async runChunk(left, right) {
            const ort = window.ort;
            const size = this.chunkSize;
            const input = new Float32Array(2 * size);

            input.set(left.subarray(0, size), 0);
            input.set(right.subarray(0, size), size);

            const inputName = this.session.inputNames[0];
            const outputName = this.session.outputNames[0];

            const tensor = new ort.Tensor(
                'float32',
                input,
                [1, 2, size]
            );

            const result = await this.session.run({
                [inputName]: tensor
            });

            const output = result[outputName];

            if (!output || !output.data || !output.dims) {
                throw new Error('HTDemucs повернула порожній результат.');
            }

            const dims = output.dims;
            const data = output.data;

            if (dims.length !== 4 || dims[1] !== 6 || dims[2] !== 2) {
                throw new Error(
                    'Несумісний формат виходу моделі. Очікується [1, 6, 2, N], отримано [' +
                    dims.join(', ') + '].'
                );
            }

            const outputLength = dims[3];
            const expected = 6 * 2 * outputLength;

            if (data.length < expected) {
                throw new Error('Розмір вихідного тензора HTDemucs некоректний.');
            }

            return { data, outputLength };
        }

        async separate(audioBuffer, options) {
            options = options || {};

            if (!audioBuffer) {
                throw new Error('Немає аудіоданих для розділення.');
            }

            if (!this.ready || !this.session) {
                throw new Error('Спочатку завантажте модель HTDemucs.');
            }

            const stereo = this.toStereo44100(audioBuffer);
            const sourceLength = stereo.left.length;

            if (!sourceLength) {
                throw new Error('Аудіофайл порожній.');
            }

            const hop = Math.floor(this.chunkSize * (1 - this.overlap));
            const accum = Array.from({ length: 6 }, () => [
                new Float32Array(sourceLength),
                new Float32Array(sourceLength)
            ]);
            const weights = new Float32Array(sourceLength);

            const totalChunks = Math.max(
                1,
                Math.ceil(Math.max(0, sourceLength - this.chunkSize) / hop) + 1
            );

            let chunkIndex = 0;

            for (let start = 0; start < sourceLength; start += hop) {
                const left = new Float32Array(this.chunkSize);
                const right = new Float32Array(this.chunkSize);

                left.set(stereo.left.subarray(start, start + this.chunkSize));
                right.set(stereo.right.subarray(start, start + this.chunkSize));

                const result = await this.runChunk(left, right);
                const outputLength = result.outputLength;
                const data = result.data;

                const usable = Math.min(
                    outputLength,
                    this.chunkSize,
                    sourceLength - start
                );

                for (let i = 0; i < usable; i++) {
                    const position = start + i;
                    const edge = Math.max(1, Math.floor(this.chunkSize * this.overlap));
                    const fadeIn = Math.min(1, i / edge);
                    const fadeOut = Math.min(1, (this.chunkSize - i) / edge);
                    const weight = Math.max(0.0001, Math.min(fadeIn, fadeOut));

                    weights[position] += weight;

                    for (let stem = 0; stem < 6; stem++) {
                        const base = stem * 2 * outputLength;
                        accum[stem][0][position] += data[base + i] * weight;
                        accum[stem][1][position] +=
                            data[base + outputLength + i] * weight;
                    }
                }

                chunkIndex++;

                if (typeof options.progress === 'function') {
                    options.progress({
                        status: 'processing',
                        progress: Math.round(chunkIndex / totalChunks * 100),
                        chunk: chunkIndex,
                        total: totalChunks
                    });
                }

                if (start + this.chunkSize >= sourceLength) break;

                // Даємо браузеру можливість оновити інтерфейс між фрагментами.
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const output = {};

            for (let stem = 0; stem < 6; stem++) {
                const left = accum[stem][0];
                const right = accum[stem][1];

                for (let i = 0; i < sourceLength; i++) {
                    const weight = weights[i];
                    if (weight > 0) {
                        left[i] /= weight;
                        right[i] /= weight;
                    }
                }

                output[this.names[stem]] = this.makeWav(
                    left,
                    right,
                    this.sampleRate
                );
            }

            if (typeof options.progress === 'function') {
                options.progress({
                    status: 'complete',
                    progress: 100
                });
            }

            return output;
        }

        isReady() {
            return this.ready && !!this.session;
        }

        dispose() {
            if (this.session && typeof this.session.release === 'function') {
                this.session.release();
            }

            this.session = null;
            this.ready = false;
        }
    }

    window.UAMSStemSeparator = UAMSStemSeparator;
})();
