(function () {
    'use strict';

    class UAMSCollection {
        constructor(config) {
            this.config = config || {};
            this.ajaxUrl = this.config.ajaxUrl || window.ajaxurl || '';
            this.nonce = this.config.nonce || '';
            this.songs = [];
        }

        async request(action, data) {
            if (!this.ajaxUrl) {
                throw new Error('Не визначено адресу WordPress AJAX.');
            }

            const body = new URLSearchParams();

            body.set('action', action);
            body.set('nonce', this.nonce);

            Object.keys(data || {}).forEach(key => {
                const value = data[key];

                body.set(
                    key,
                    typeof value === 'string'
                        ? value
                        : JSON.stringify(value)
                );
            });

            const response = await fetch(this.ajaxUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body.toString()
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                const message = result &&
                    result.data &&
                    result.data.message
                    ? result.data.message
                    : 'Помилка запиту до сервера.';

                throw new Error(message);
            }

            return result.data;
        }

        async load() {
            const data = await this.request(
                'uams_get_collection',
                {}
            );

            this.songs = Array.isArray(data.songs)
                ? data.songs
                : [];

            return this.songs;
        }

        async save(song) {
            if (!song || !song.title) {
                throw new Error('Вкажіть назву композиції.');
            }

            const data = await this.request(
                'uams_save_song',
                {
                    song: song
                }
            );

            await this.load();

            return data;
        }

        async remove(id) {
            if (!id) {
                throw new Error('Не визначено композицію.');
            }

            const data = await this.request(
                'uams_delete_song',
                {
                    id: id
                }
            );

            await this.load();

            return data;
        }

        async updateNotes(id, notes) {
            if (!id) {
                throw new Error('Не визначено композицію.');
            }

            const data = await this.request(
                'uams_update_notes',
                {
                    id: id,
                    notes: notes
                }
            );

            await this.load();

            return data;
        }

        find(query) {
            query = String(query || '').toLowerCase().trim();

            if (!query) {
                return this.songs.slice();
            }

            return this.songs.filter(song => {
                const content = [
                    song.title,
                    song.key,
                    song.notes,
                    song.artist
                ].join(' ').toLowerCase();

                return content.includes(query);
            });
        }

        sort(mode) {
            const songs = this.songs.slice();

            if (mode === 'title') {
                songs.sort((a, b) =>
                    String(a.title).localeCompare(String(b.title))
                );
            } else if (mode === 'oldest') {
                songs.reverse();
            } else {
                songs.sort((a, b) =>
                    Number(b.created || 0) - Number(a.created || 0)
                );
            }

            return songs;
        }
    }

    window.UAMSCollection = UAMSCollection;
})();
