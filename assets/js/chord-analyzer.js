(function () {
    'use strict';

    const NOTES = [
        'C', 'C#', 'D', 'D#', 'E', 'F',
        'F#', 'G', 'G#', 'A', 'A#', 'B'
    ];

    const CHORD_TEMPLATES = [
        { name: '', intervals: [0, 4, 7], type: 'major' },
        { name: 'm', intervals: [0, 3, 7], type: 'minor' },
        { name: '7', intervals: [0, 4, 7, 10], type: 'dominant7' },
        { name: 'maj7', intervals: [0, 4, 7, 11], type: 'major7' },
        { name: 'm7', intervals: [0, 3, 7, 10], type: 'minor7' }
    ];

    class UAMSChordAnalyzer {
        constructor() {
            this.sampleRate = 22050;
        }

        frequencyToNote(frequency) {
            return Math.round(
                12 * Math.log2(frequency / 440) + 69
            );
        }

        noteName(midi) {
            return NOTES[((midi % 12) + 12) % 12];
        }

        analyzeBuffer(audioBuffer) {
            if (!audioBuffer) {
                throw new Error('Немає аудіоданих для аналізу.');
            }

            const mono = this.toMono(audioBuffer);
            const chroma = this.calculateChroma(
                mono,
                audioBuffer.sampleRate
            );

            return {
                key: this.detectKey(chroma),
                bpm: this.detectBpm(mono, audioBuffer.sampleRate),
                chroma: chroma,
                chords: this.detectChords(
                    mono,
                    audioBuffer.sampleRate
                )
            };
        }

        toMono(buffer) {
            const length = buffer.length;
            const mono = new Float32Array(length);

            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel);

                for (let i = 0; i < length; i++) {
                    mono[i] += data[i] / buffer.numberOfChannels;
                }
            }

            return mono;
        }

        calculateChroma(samples, sampleRate) {
            const chroma = new Array(12).fill(0);
            const frameSize = 4096;
            const hop = 2048;

            for (
                let start = 0;
                start + frameSize <= samples.length;
                start += hop
            ) {
                const frame = samples.subarray(start, start + frameSize);
                const spectrum = this.simpleSpectrum(frame);

                for (let bin = 1; bin < spectrum.length; bin++) {
                    const frequency = bin * sampleRate / frameSize;

                    if (frequency < 55 || frequency > 2000) {
                        continue;
                    }

                    const midi = this.frequencyToNote(frequency);
                    const note = ((midi % 12) + 12) % 12;

                    chroma[note] += spectrum[bin];
                }
            }

            const max = Math.max(...chroma, 1);

            return chroma.map(value => value / max);
        }

        simpleSpectrum(frame) {
            const size = frame.length;
            const bins = Math.floor(size / 2);
            const result = new Float32Array(bins);

            for (let k = 0; k < bins; k++) {
                let real = 0;
                let imag = 0;

                for (let n = 0; n < size; n++) {
                    const window =
                        0.5 - 0.5 * Math.cos(2 * Math.PI * n / (size - 1));

                    const angle = 2 * Math.PI * k * n / size;
                    const sample = frame[n] * window;

                    real += sample * Math.cos(angle);
                    imag -= sample * Math.sin(angle);
                }

                result[k] = Math.sqrt(real * real + imag * imag);
            }

            return result;
        }

        detectKey(chroma) {
            const major = [
                6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                2.52, 5.19, 2.39, 3.66, 2.29, 2.88
            ];

            const minor = [
                6.33, 2.68, 3.52, 5.38, 2.6, 3.53,
                2.54, 4.75, 3.98, 2.69, 3.34, 3.17
            ];

            let best = {
                score: -Infinity,
                key: 'C',
                mode: 'major'
            };

            for (let root = 0; root < 12; root++) {
                for (const mode of ['major', 'minor']) {
                    const profile = mode === 'major' ? major : minor;
                    let score = 0;

                    for (let i = 0; i < 12; i++) {
                        score += chroma[(i + root) % 12] * profile[i];
                    }

                    if (score > best.score) {
                        best = {
                            score: score,
                            key: NOTES[root],
                            mode: mode
                        };
                    }
                }
            }

            return best.key + (best.mode === 'minor' ? ' minor' : ' major');
        }

        detectChords(samples, sampleRate) {
            const frameSize = 4096;
            const hop = 22050;
            const chords = [];

            for (
                let start = 0;
                start + frameSize <= samples.length;
                start += hop
            ) {
                const frame = samples.subarray(start, start + frameSize);
                const spectrum = this.simpleSpectrum(frame);
                const chroma = new Array(12).fill(0);

                for (let bin = 1; bin < spectrum.length; bin++) {
                    const frequency = bin * sampleRate / frameSize;

                    if (frequency < 55 || frequency > 1500) {
                        continue;
                    }

                    const midi = this.frequencyToNote(frequency);
                    chroma[((midi % 12) + 12) % 12] += spectrum[bin];
                }

                const chord = this.bestChord(chroma);

                if (chord) {
                    chords.push({
                        time: start / sampleRate,
                        name: chord.name
                    });
                }
            }

            return this.removeRepeatedChords(chords);
        }

        bestChord(chroma) {
            let best = null;
            let bestScore = -Infinity;

            for (let root = 0; root < 12; root++) {
                for (const template of CHORD_TEMPLATES) {
                    let score = 0;

                    for (let i = 0; i < 12; i++) {
                        const relative = (i - root + 12) % 12;
                        const expected = template.intervals.includes(relative);

                        score += chroma[i] * (expected ? 1 : -0.35);
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = {
                            name: NOTES[root] + template.name,
                            score: score
                        };
                    }
                }
            }

            return best;
        }

        removeRepeatedChords(chords) {
            const output = [];

            for (const chord of chords) {
                const last = output[output.length - 1];

                if (!last || last.name !== chord.name) {
                    output.push(chord);
                }
            }

            return output;
        }

        detectBpm(samples, sampleRate) {
            const windowSize = 1024;
            const envelope = [];

            for (let i = 0; i < samples.length; i += windowSize) {
                let energy = 0;
                const end = Math.min(i + windowSize, samples.length);

                for (let j = i; j < end; j++) {
                    energy += samples[j] * samples[j];
                }

                envelope.push(Math.sqrt(energy / Math.max(1, end - i)));
            }

            const changes = envelope.map((value, index) => {
                if (index === 0) return 0;
                return Math.max(0, value - envelope[index - 1]);
            });

            let bestLag = 0;
            let bestScore = -Infinity;

            const minLag = Math.floor(
                60 * sampleRate / windowSize / 200
            );

            const maxLag = Math.ceil(
                60 * sampleRate / windowSize / 50
            );

            for (let lag = Math.max(1, minLag); lag <= maxLag; lag++) {
                let score = 0;

                for (let i = lag; i < changes.length; i++) {
                    score += changes[i] * changes[i - lag];
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestLag = lag;
                }
            }

            if (!bestLag) return null;

            let bpm = 60 * sampleRate / (windowSize * bestLag);

            while (bpm < 70) bpm *= 2;
            while (bpm > 180) bpm /= 2;

            return Math.round(bpm);
        }

        transposeChord(chord, semitones) {
            const match = String(chord).match(/^([A-G]#?)(.*)$/);

            if (!match) return chord;

            const index = NOTES.indexOf(match[1]);

            if (index < 0) return chord;

            const next = (
                index + Number(semitones) + 120
            ) % 12;

            return NOTES[next] + match[2];
        }

        transposeChords(chords, semitones) {
            return chords.map(chord => ({
                ...chord,
                name: this.transposeChord(chord.name, semitones)
            }));
        }
    }

    window.UAMSChordAnalyzer = UAMSChordAnalyzer;
})();
