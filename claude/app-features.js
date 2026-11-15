/* Keep version.json and this identifier in sync whenever the site is released. */
(() => {
    const VERSION = '2026-11-15-takes-live-1';
    const BUILD_TIME = '2026-11-15T11:01:05.673Z';
    const KEY = 'harmony-singer-settings-v1';
    const params = new URLSearchParams(location.search);
    const selects = { keyRoot: 'key', engineSelect: 'engine', backingSelect: 'backing', backingStyleSelect: 'backingStyle', recordMode: 'recordmode' };
    const sliders = ['harmonyVolume', 'dryVolume', 'reverbAmount', 'chorusAmount', 'smoothing'];
    const groups = { mode: 'mode', scale: 'scale', position: null };
    function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } }
    function save() {
        const state = { extraProtection: !!document.getElementById('extraProtection')?.checked, outputProtection: Number(document.getElementById('outputPosition')?.value || 0), selects: {}, sliders: {}, groups: {}, voices: {}, speaker: document.getElementById('speakerModeToggle').classList.contains('on') };
        for (const id of Object.keys(selects)) state.selects[id] = document.getElementById(id).value;
        for (const id of sliders) state.sliders[id] = document.getElementById(id).value;
        for (const group of Object.keys(groups)) state.groups[group] = document.querySelector(`[data-${group}].active`)?.dataset[group];
        document.querySelectorAll('.toggle[data-voice]').forEach(el => { state.voices[el.dataset.voice] = el.classList.contains('on'); });
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* Settings remain usable when storage is unavailable. */ }
    }
    function restore() {
        const state = read();
        for (const [id, param] of Object.entries(selects)) {
            const el = document.getElementById(id), value = state.selects?.[id];
            if (!params.has(param) && typeof value === 'string' && [...el.options].some(o => o.value === value)) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        for (const id of sliders) {
            const el = document.getElementById(id), value = Number(state.sliders?.[id]);
            if (state.sliders?.[id] != null && Number.isFinite(value) && value >= 0 && value <= 100) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
        }
        for (const [group, param] of Object.entries(groups)) {
            if (param && params.has(param)) continue;
            const value = state.groups?.[group];
            document.querySelectorAll(`[data-${group}]`).forEach(el => { if (el.dataset[group] === value && !el.classList.contains('active')) el.click(); });
        }
        document.querySelectorAll('.toggle[data-voice]').forEach(el => { const value = state.voices?.[el.dataset.voice]; if (typeof value === 'boolean' && value !== el.classList.contains('on')) el.click(); });
        const extra=document.getElementById('extraProtection');
        if(extra&&typeof state.extraProtection==='boolean'){extra.checked=state.extraProtection;extra.dispatchEvent(new Event('change',{bubbles:true}));}
        const speaker = document.getElementById('speakerModeToggle');
        if (!params.has('speaker') && [0,1].includes(state.outputProtection)) window.harmonySinger.setOutputPosition(state.outputProtection);
        else if (!params.has('speaker') && typeof state.speaker === 'boolean' && state.speaker !== speaker.classList.contains('on')) speaker.click();
        document.addEventListener('input', e => { if (sliders.includes(e.target.id) || e.target.id==='outputPosition') save(); });
        document.addEventListener('change', e => { if (Object.hasOwn(selects, e.target.id) || ['outputPosition','extraProtection'].includes(e.target.id)) save(); });
        document.addEventListener('click', e => { if (e.target.closest('[data-mode], [data-scale], [data-position], .toggle[data-voice], #speakerModeToggle')) save(); });
    }
    async function checkUpdate() {
        try {
            const response = await fetch('version.json', { cache: 'no-store' });
            if (!response.ok) return;
            const latest = await response.json();
            if(latest.version===VERSION)window.HarmonyBuildMeta=latest;
            if (typeof latest.version === 'string' && latest.version !== VERSION) {
                document.getElementById('releaseStatus').textContent = 'A new version is available';
                document.getElementById('refreshVersion').textContent = 'Update · reload';
                document.getElementById('refreshVersion').hidden = false;
            }
        } catch (_) { /* Continue working offline or when the check is unavailable. */ }
    }
    function renderBuildTime() {
        const info = HarmonyReleaseTime.format(BUILD_TIME);
        const el = document.getElementById('buildTime');
        el.textContent = info.label;
        if (info.datetime) el.setAttribute('datetime', info.datetime); else el.removeAttribute('datetime');
        if (info.detail) el.title = info.detail; else el.removeAttribute('title');
        document.getElementById('buildDetail').textContent = info.detail || '';
    }
    window.addEventListener('DOMContentLoaded', () => {
        restore();
        document.getElementById('refreshVersion').addEventListener('click', () => location.reload());
        document.getElementById('checkVersion')?.addEventListener('click',checkUpdate);
        renderBuildTime();
        checkUpdate();
        let timer = null;
        let ticks = 0;
        function startClock() {
            if (timer !== null || document.hidden) return;
            timer = setInterval(() => { renderBuildTime(); if (++ticks % 5 === 0) checkUpdate(); }, 60000);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { if (timer !== null) clearInterval(timer); timer = null; }
            else { renderBuildTime(); checkUpdate(); startClock(); }
        });
        startClock();
    });
})();
