/* Harmony build-time presentation. Pure functions are also used by the tests. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.HarmonyReleaseTime = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    function format(value, now = Date.now(), locale, timeZone) {
        const options = timeZone ? { timeZone } : {};
        if (typeof value !== 'string') return { label: 'Build time unavailable' };
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const date = new Date(value + 'T00:00:00Z');
            if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { label: 'Build time unavailable' };
            return { label: 'Built ' + new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date), detail: 'Date only' };
        }
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return { label: 'Build time unavailable' };
        const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
        const calendar = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
        if (calendar.getUTCFullYear() !== +parts[1] || calendar.getUTCMonth() !== +parts[2] - 1 || calendar.getUTCDate() !== +parts[3] || +parts[4] > 23 || +parts[5] > 59 || +parts[6] > 59) return { label: 'Build time unavailable' };
        const date = new Date(value), stamp = date.getTime();
        if (!Number.isFinite(stamp) || !Number.isFinite(now)) return { label: 'Build time unavailable' };
        const detail = new Intl.DateTimeFormat(locale, { ...options, dateStyle: 'full', timeStyle: 'long' }).format(date);
        const diff = now - stamp;
        if (diff < -120000) return { label: 'Build time is in the future (check clock)', detail, datetime: date.toISOString() };
        const seconds = Math.max(0, diff / 1000);
        let relative;
        if (seconds < 60) relative = new Intl.DateTimeFormat(locale).resolvedOptions().locale.toLowerCase().startsWith('en') ? 'just now' : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
        else {
            let amount, unit;
            if (seconds < 3600) { amount = Math.floor(seconds / 60); unit = 'minute'; }
            else if (seconds < 86400) { amount = Math.floor(seconds / 3600); unit = 'hour'; }
            else if (seconds < 604800) { amount = Math.floor(seconds / 86400); unit = 'day'; }
            if (unit) {
                const lang = new Intl.DateTimeFormat(locale).resolvedOptions().locale;
                relative = lang.toLowerCase().startsWith('en') ? `${amount}${{ minute: 'm', hour: 'h', day: 'd' }[unit]} ago` : new Intl.RelativeTimeFormat(locale, { style: 'short', numeric: 'always' }).format(-amount, unit);
            } else {
                const year = new Intl.DateTimeFormat('en', { ...options, year: 'numeric' });
                const includeYear = year.format(date) !== year.format(new Date(now));
                relative = new Intl.DateTimeFormat(locale, { ...options, month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) }).format(date);
            }
        }
        return { label: 'Built ' + relative, detail, datetime: date.toISOString() };
    }
    return { format };
});
