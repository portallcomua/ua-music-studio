(function () {
    'use strict';

    class UAMSAudioEngine {
        constructor() {
            this.context = null;
            this.buffer = null;
            this.source = null;
            this.audio = new Audio();
            this.objectUrl = null;
            this.startedAt = 0;
            this.pausedAt = 0;
            this.duration = 0;
            this.isPlaying = false;
            this.onTimeUpdate = null;
            this.onEnded = null;
            this.onLoaded = null;
            this.onError = null;

            this.audio.preload = 'auto';

            this.audio.addEventListener('timeupdate', () => {
                if (typeof this.onTimeUpdate === 'function') {
                    this.onTimeUpdate(
                        this.audio.currentTime,
                        this.audio.duration || 0
                    );
                }
            });

            this.audio.addEventListener('ended', () => {
                this.isPlaying = false;
                if (typeof this.onEnded === 'function') {
                    this.onEnded();
                }
            });

            this.audio.addEventListener('loadedmetadata', () => {
                this.duration = this.audio.duration || 0;
                if (typeof this.onLoaded === 'function') {
                    this.onLoaded(this.duration);
                }
            });

            this.audio.addEventListener('error', () => {
                if (typeof this.onError === 'function') {
                    this.onError('Не вдалося відкрити аудіофайл.');
                }
            });
        }

        getContext() {
            if (!this.context) {
                const AudioContextClass =
                    window.AudioContext || window.webkitAudioContext;

                if (!AudioContextClass) {
                    throw new Error('Браузер не підтримує Web Audio API.');
                }

                this.context = new AudioContextClass();
            }

            return this.context;
        }

        async loadFile(file) {
            if (!file) {
                throw new Error('Файл не вибрано.');
            }

            if (!file.type.startsWith('audio/') &&
                !/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name)) {
                throw new Error('Виберіть аудіофайл.');
            }

            this.stop();
            this.revokeUrl();

            this.objectUrl = URL.createObjectURL(file);
            this.audio.src = this.objectUrl;
            this.audio.load();

            await new Promise((resolve, reject) => {
                const success = () => {
                    cleanup();
                    resolve();
                };

                const failure = () => {
                    cleanup();
                    reject(new Error('Не вдалося завантажити аудіофайл.'));
                };

                const cleanup = () => {
                    this.audio.removeEventListener('loadedmetadata', success);
                    this.audio.removeEventListener('error', failure);
                };

                this.audio.addEventListener('loadedmetadata', success, {
                    once: true
                });

                this.audio.addEventListener('error', failure, {
                    once: true
                });
            });

            this.duration = this.audio.duration || 0;

            try {
                const arrayBuffer = await file.arrayBuffer();
                this.buffer = await this.getContext().decodeAudioData(
                    arrayBuffer.slice(0)
                );
            } catch (error) {
                this.buffer = null;
            }

            return {
                name: file.name,
                size: file.size,
                duration: this.duration,
                type: file.type
            };
        }

        async loadUrl(url) {
            if (!url || !/^https?:\/\//i.test(url)) {
                throw new Error('Введіть правильне HTTP або HTTPS посилання.');
            }

            this.stop();
            this.revokeUrl();

            this.audio.crossOrigin = 'anonymous';
            this.audio.src = url;
            this.audio.load();

            await new Promise((resolve, reject) => {
                const success = () => {
                    cleanup();
                    resolve();
                };

                const failure = () => {
                    cleanup();
                    reject(new Error(
                        'Не вдалося відкрити посилання. Сервер може забороняти доступ із браузера.'
                    ));
                };

                const cleanup = () => {
                    this.audio.removeEventListener('loadedmetadata', success);
                    this.audio.removeEventListener('error', failure);
                };

                this.audio.addEventListener('loadedmetadata', success, {
                    once: true
                });

                this.audio.addEventListener('error', failure, {
                    once: true
                });
            });

            this.duration = this.audio.duration || 0;

            try {
                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }

                const data = await response.arrayBuffer();
                this.buffer = await this.getContext().decodeAudioData(data);
            } catch (error) {
                this.buffer = null;
            }

            return {
                name: url,
                duration: this.duration,
                remote: true
            };
        }

        async play() {
            if (!this.audio.src) {
                throw new Error('Спочатку завантажте композицію.');
            }

            await this.audio.play();
            this.isPlaying = true;
        }

        pause() {
            this.audio.pause();
            this.isPlaying = false;
        }

        stop() {
            this.audio.pause();

            try {
                this.audio.currentTime = 0;
            } catch (error) {
                // Метадані ще можуть бути недоступними.
            }

            this.isPlaying = false;
            this.pausedAt = 0;
        }

        seek(seconds) {
            if (!Number.isFinite(seconds)) {
                return;
            }

            const max = Number.isFinite(this.audio.duration)
                ? this.audio.duration
                : seconds;

            this.audio.currentTime = Math.max(0, Math.min(seconds, max));
        }

        setVolume(value) {
            this.audio.volume = Math.max(0, Math.min(1, Number(value)));
        }

        getCurrentTime() {
            return this.audio.currentTime || 0;
        }

        getDuration() {
            return this.audio.duration || this.duration || 0;
        }

        getBuffer() {
            return this.buffer;
        }

        getAudioElement() {
            return this.audio;
        }

        async exportWav() {
            if (!this.buffer) {
                throw new Error(
                    'Для експорту потрібні доступні аудіодані. Для зовнішнього URL сервер має дозволяти CORS.'
                );
            }

            const buffer = this.buffer;
            const channels = buffer.numberOfChannels;
            const sampleRate = buffer.sampleRate;
            const frames = buffer.length;
            const bytesPerSample = 2;
            const dataSize = frames * channels * bytesPerSample;
            const output = new ArrayBuffer(44 + dataSize);
            const view = new DataView(output);

            const writeString = (offset, value) => {
                for (let i = 0; i < value.length; i++) {
                    view.setUint8(offset + i, value.charCodeAt(i));
                }
            };

            writeString(0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, channels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(
                28,
                sampleRate * channels * bytesPerSample,
                true
            );
            view.setUint16(32, channels * bytesPerSample, true);
            view.setUint16(34, 16, true);
            writeString(36, 'data');
            view.setUint32(40, dataSize, true);

            let offset = 44;

            for (let i = 0; i < frames; i++) {
                for (let channel = 0; channel < channels; channel++) {
                    let sample = buffer.getChannelData(channel)[i];
                    sample = Math.max(-1, Math.min(1, sample));

                    view.setInt16(
                        offset,
                        sample < 0 ? sample * 32768 : sample * 32767,
                        true
                    );

                    offset += 2;
                }
            }

            return new Blob([output], { type: 'audio/wav' });
        }

        revokeUrl() {
            if (this.objectUrl) {
                URL.revokeObjectURL(this.objectUrl);
                this.objectUrl = null;
            }
        }

        destroy() {
            this.stop();
            this.revokeUrl();

            if (this.context && this.context.state !== 'closed') {
                this.context.close();
            }
        }
    }

    window.UAMSAudioEngine = UAMSAudioEngine;
})();
