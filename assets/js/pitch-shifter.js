(function () {
    'use strict';

    class UAMSPitchShifter {
        constructor() {
            this.semitones = 0;
            this.frameSize = 2048;
            this.analysisHop = 512;
        }

        fft(real, imag, inverse) {
            const n = real.length;
            let j = 0;

            for (let i = 1; i < n; i++) {
                let bit = n >> 1;
                while (j & bit) {
                    j ^= bit;
                    bit >>= 1;
                }
                j ^= bit;

                if (i < j) {
                    [real[i], real[j]] = [real[j], real[i]];
                    [imag[i], imag[j]] = [imag[j], imag[i]];
                }
            }

            for (let size = 2; size <= n; size <<= 1) {
                const angle = (inverse ? 2 : -2) * Math.PI / size;
                const wlenR = Math.cos(angle);
                const wlenI = Math.sin(angle);

                for (let i = 0; i < n; i += size) {
                    let wr = 1;
                    let wi = 0;
                    const half = size >> 1;

                    for (let k = 0; k < half; k++) {
                        const even = i + k;
                        const odd = even + half;

                        const tr = real[odd] * wr - imag[odd] * wi;
                        const ti = real[odd] * wi + imag[odd] * wr;

                        real[odd] = real[even] - tr;
                        imag[odd] = imag[even] - ti;
                        real[even] += tr;
                        imag[even] += ti;

                        const nextWr = wr * wlenR - wi * wlenI;
                        wi = wr * wlenI + wi * wlenR;
                        wr = nextWr;
                    }
                }
            }

            if (inverse) {
                for (let i = 0; i < n; i++) {
                    real[i] /= n;
                    imag[i] /= n;
                }
            }
        }

        wrapPhase(value) {
            while (value > Math.PI) value -= 2 * Math.PI;
            while (value < -Math.PI) value += 2 * Math.PI;
            return value;
        }

        stretch(input, factor) {
            const N = this.frameSize;
            const H = this.analysisHop;
            const bins = N / 2 + 1;
            const outputLength = Math.ceil(input.length * factor) + N * 2;
            const output = new Float32Array(outputLength);
            const weights = new Float32Array(outputLength);

            const window = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
            }

            const previousPhase = new Float64Array(bins);
            const synthesisPhase = new Float64Array(bins);
            const expectedPhase = new Float64Array(bins);

            for (let k = 0; k < bins; k++) {
                expectedPhase[k] = 2 * Math.PI * H * k / N;
            }

            const synthesisHop = H * factor;
            const frames = Math.ceil((input.length - N) / H);

            for (let frame = 0; frame <= frames; frame++) {
                const inputStart = frame * H;
                const outputStart = Math.round(frame * synthesisHop);

                const real = new Float64Array(N);
                const imag = new Float64Array(N);

                for (let i = 0; i < N; i++) {
                    const sample = input[inputStart + i] || 0;
                    real[i] = sample * window[i];
                }

                this.fft(real, imag, false);

                for (let k = 0; k < bins; k++) {
                    const magnitude = Math.hypot(real[k], imag[k]);
                    const phase = Math.atan2(imag[k], real[k]);

                    if (frame === 0) {
                        synthesisPhase[k] = phase;
                    } else {
                        const delta = this.wrapPhase(
                            phase - previousPhase[k] - expectedPhase[k]
                        );

                        const trueFrequency =
                            2 * Math.PI * k / N + delta / H;

                        synthesisPhase[k] += trueFrequency * synthesisHop;
                    }

                    previousPhase[k] = phase;

                    real[k] = magnitude * Math.cos(synthesisPhase[k]);
                    imag[k] = magnitude * Math.sin(synthesisPhase[k]);
                }

                for (let k = 1; k < N / 2; k++) {
                    real[N - k] = real[k];
                    imag[N - k] = -imag[k];
                }

                this.fft(real, imag, true);

                for (let i = 0; i < N; i++) {
                    const position = outputStart + i;
                    if (position >= outputLength) break;

                    const w = window[i];
                    output[position] += real[i] * w;
                    weights[position] += w * w;
                }
            }

            for (let i = 0; i < output.length; i++) {
                if (weights[i] > 0.000001) {
                    output[i] /= weights[i];
                }
            }

            return output;
        }

        resample(input, outputLength) {
            const output = new Float32Array(outputLength);
            const ratio = input.length / outputLength;

            for (let i = 0; i < outputLength; i++) {
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

        async process(audioBuffer, semitones, progressCallback) {
            if (!(audioBuffer instanceof AudioBuffer)) {
                throw new Error('Немає коректних аудіоданих.');
            }

            const shift = Math.max(-12, Math.min(12, Number(semitones) || 0));
            this.semitones = shift;

            if (shift === 0) return audioBuffer;

            const pitchFactor = Math.pow(2, shift / 12);
            const stretchFactor = pitchFactor;
            const context = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: audioBuffer.sampleRate
            });

            const result = context.createBuffer(
                audioBuffer.numberOfChannels,
                audioBuffer.length,
                audioBuffer.sampleRate
            );

            try {
                for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
                    if (progressCallback) {
                        progressCallback({
                            channel: channel + 1,
                            total: audioBuffer.numberOfChannels,
                            progress: Math.round(channel / audioBuffer.numberOfChannels * 100)
                        });
                    }

                    const source = audioBuffer.getChannelData(channel);
                    const stretched = this.stretch(source, stretchFactor);
                    const start = Math.floor(this.frameSize);
                    const usable = stretched.subarray(
                        start,
                        Math.min(stretched.length, start + Math.ceil(source.length * stretchFactor))
                    );

                    const shifted = this.resample(usable, audioBuffer.length);
                    result.copyToChannel(shifted, channel);
                }

                if (progressCallback) {
                    progressCallback({ progress: 100, complete: true });
                }

                return result;
            } finally {
                await context.close().catch(() => {});
            }
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
