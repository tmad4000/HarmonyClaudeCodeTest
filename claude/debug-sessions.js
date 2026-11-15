/* Device-private debugging. No server, upload, analytics or device identifiers. */
(() => {
    class DebugSessions {
        constructor(panel) {
            this.finalizing=new Set(); this.generation = 0; this.starting = false; this.panel = panel; this.enabled = true; try { this.enabled = localStorage.getItem('harmony-debug-v1') !== 'off'; } catch (_) {}
            if(new URLSearchParams(location.search).get('debug')==='0') this.enabled=false;
            this.store=new LocalSessionStore('harmony-debug-v1');
            this.db=this.store.db;
            this.db.catch(() => this.status('Storage unavailable — no debug audio is saved'));
            this.panel.querySelector('input').checked = this.enabled;
            this.panel.querySelector('input').onchange = e => {
                this.enabled = e.target.checked; try { localStorage.setItem('harmony-debug-v1', this.enabled ? 'on' : 'off'); } catch (_) {}
                if (!this.enabled) this.stop();
                this.status(this.enabled ? 'Debug recording ON · ready' : 'Debug recording OFF');
            };
            this.panel.querySelector('[data-skip]').onclick = () => {this.skip=true;this.status('Not recording this take');if(!window.harmonySinger.isRunning)document.getElementById('startBtn').click();else this.stop();};
            this.panel.querySelector('[data-mark]').onclick=()=>this.event?.({type:'mark',t:Math.round(performance.now()),label:'Problem moment'});
            this.panel.querySelector('[data-review]').onclick = () => this.review().catch(e => this.status(e.message));
            this.status(this.enabled ? 'Debug recording ON · ready' : 'Debug recording OFF');
            this.prune().catch(() => {});
            document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='m'&&!/input|textarea|select/i.test(e.target.tagName))this.event?.({type:'mark',t:Math.round(performance.now()),label:'Problem moment'});});
        }
        status(text) { document.querySelector('[data-status]').textContent = text; }
        rows(){return this.store.rows();}
        write(row,remove,chunk){return this.store.write(row,remove,chunk);}
        audio(row){return this.store.audio(row);}
        async prune(){const result=await this.store.prune();if(result.full&&this.recorder)this.limitAudio('storage full: unpin or export · events continue');if(this.activeId&&!(await this.rows()).some(r=>r.id===this.activeId))throw new Error('Not saving · session storage limit');return result;}
        async startEventsOnly(h,generation) {
            if(!this.enabled||!h.isRunning||generation!==this.generation)return;
            const id=crypto.randomUUID(),events=h.getLog().slice(-100),row={id,started:Date.now(),kind:'events',settings:h.snapshotSettings(),browser:navigator.userAgent,platform:navigator.platform,version:document.querySelector('meta[name="harmony-version"]')?.content,events};
            this.activeId=id;this.latestId=id;
            const persist=async()=>{try{await this.write({...row,events:events.slice(),bytes:new Blob([JSON.stringify(events)]).size});}catch(_){if(this.activeId===id)this.stop();if(this.latestId===id)this.status('Not saving · storage unavailable');}};
            this.event=e=>{if(events.length<5000)events.push(JSON.parse(JSON.stringify(e,(k,v)=>['deviceId','groupId'].includes(k)?undefined:v)));};
            this.flush=()=>{if(this.activeId!==id)row.ended=Date.now();return persist();};this.eventTimer=setInterval(persist,5000);
            await persist();this.status('storage full: unpin or export · events continue');
        }
        async start(h) {
            if(this.skip)return;
            if (!this.enabled || this.recorder || this.starting) return;
            const generation = ++this.generation; this.starting = true;this.audioLimited=false;
            let cleanup = () => {};
            try {
                await this.db;
                const storage=await this.prune();
                if(storage.full){await this.startEventsOnly(h,generation);return;}
                if (!this.enabled || !h.isRunning || generation !== this.generation) return;
                const source = h.micSource, limiter = h.limiter;
                const ctx = h.audioContext, dest = ctx.createMediaStreamDestination(), merger = ctx.createChannelMerger(2);
                // Record raw mic and final mono output separately. Never connect recording to speakers.
                const mic = ctx.createGain(), out = ctx.createGain();
                mic.channelCount = out.channelCount = 1; mic.channelCountMode = out.channelCountMode = 'explicit';
                h.micSource.connect(mic); Tone.connect(h.limiter, out); mic.connect(merger,0,0); out.connect(merger,0,1); merger.connect(dest);
                cleanup = () => { for (const n of [mic,out,merger,dest]) { try {n.disconnect();} catch (_) {} } try {source.disconnect(mic);} catch (_) {} try {Tone.disconnect(limiter,out);} catch (_) {} dest.stream.getTracks().forEach(t=>t.stop()); };
                const mimeType = ['audio/webm;codecs=opus','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
                const rec = this.recorder = new MediaRecorder(dest.stream, mimeType ? {mimeType,audioBitsPerSecond:96000} : {audioBitsPerSecond:96000});
                const started = Date.now(), id = crypto.randomUUID(); let bytes = 0, index = 0, failed=false;
                const sanitize=e=>JSON.parse(JSON.stringify(e,(key,value)=>['deviceId','groupId'].includes(key)?undefined:value));
                const events = h.getLog().slice(-100).map(sanitize), settings = h.snapshotSettings();
                this.activeId=id;this.latestId=id;
                const row = {id,started,settings,events,bytes:0,mimeType:rec.mimeType,version:document.querySelector('meta[name="harmony-version"]')?.content || 'unavailable',buildTime:document.getElementById('buildTime')?.getAttribute('datetime'),browser:navigator.userAgent};
                const persist=async(chunk)=>{try{await this.write({...row,events:events.slice(),bytes},false,chunk);await this.prune();}catch(_){failed=true;if(this.activeId===id)this.stop();if(this.latestId===id)this.status('Not saving · storage full or unavailable');}};
                await this.write({...row});
                if (!this.enabled || !h.isRunning || generation !== this.generation || this.recorder !== rec) { cleanup(); return; }
                this.event = e => { if (events.length < 20000) events.push(sanitize(e)); };
                this.flush=()=>persist();
                this.eventTimer=setInterval(()=>persist(),5000);
                this.clock=setInterval(()=>{if(this.recorder===rec)this.status('● Debug rec '+Math.floor((Date.now()-started)/60000)+':'+String(Math.floor((Date.now()-started)/1000)%60).padStart(2,'0'));},1000);
                rec.ondataavailable = e => {
                    if (e.data.size) { bytes += e.data.size; persist({id:`${id}:${index}`,session:id,index:index++,blob:e.data}); }
                    if (bytes > 20*1024*1024 && this.recorder === rec) this.limitAudio('Audio size limit reached; events continue');
                };
                rec.onstop = async () => {
                    cleanup(); row.audioEnded=Date.now();
                    await persist();this.finalizing.delete(id);
                    if (!failed && !this.audioLimited && !this.recorder && !this.starting) this.status(this.enabled ? 'Debug session saved · ready for next start' : 'Debug recording OFF · session saved');
                };
                rec.onerror = () => { if(this.recorder===rec){this.status('Debug recorder failed');this.stop();} };
                rec.start(2000); this.status('Debug recording ON · mic + output · this device only');
                this.timer = setTimeout(() => this.limitAudio('10 minute audio limit; events continue'), 10*60*1000);
            } catch (e) { cleanup(); if(generation===this.generation){this.recorder=null;this.activeId=null;this.status('Debug recording unavailable: '+e.message);} } finally { if(generation===this.generation) this.starting=false; }
        }
        limitAudio(reason) {this.audioLimited=true;clearTimeout(this.timer);clearInterval(this.clock);if(this.recorder?.state==='recording')this.recorder.stop();this.recorder=null;this.status(reason);}
        stop(reason) { const id=this.activeId,wasRecording=this.recorder?.state==='recording';if(id)this.finalizing.add(id);this.activeId=null; this.audioLimited=false;clearInterval(this.clock);clearInterval(this.eventTimer);const pending=this.flush?.();this.flush=null;if(id&&!wasRecording)Promise.resolve(pending).finally(()=>this.finalizing.delete(id)); this.generation++; this.starting=false; clearTimeout(this.timer); if(reason) this.status(reason+' · capture paused'); this.event = null; if (this.recorder?.state === 'recording') this.recorder.stop(); this.recorder = null; }
        metrics(events) {
            const stats=events.filter(e=>e.type==='stats'),voiced=stats.filter(e=>e.voiced),active=voiced.filter(e=>e.gate);
            const span=events.length?Math.max(1,(events.at(-1).t-events[0].t)/60000):1;
            return {harmonyGateOnPct:voiced.length?Math.round(active.length/voiced.length*100):null,gateTogglesPerMin:events.filter(e=>e.type==='gate').length/span,retargetsPerMin:events.filter(e=>e.type==='note').length/span,notches:events.filter(e=>e.type==='notch').length,marks:events.filter(e=>e.type==='mark').map(e=>e.t),hardwareUnderruns:null,dropoutsPerMin:null,note:'Gate ratio sampled at2Hz; envelope dropouts and hardware underruns unavailable'};
        }
        async review() {
            await this.prune(); const list = this.panel.querySelector('[data-sessions]'); list.replaceChildren();
            const rows = (await this.rows()).sort((a,b)=>b.started-a.started);
            if (!rows.length) list.textContent = 'No saved sessions on this browser.';
            for (const r of rows) {
                const row = document.createElement('p'); row.textContent = new Date(r.started).toLocaleString()+' · '+(r.settings.speakerMode?'Speakers':'Headphones')+' · '+Math.round(((r.audioEnded||Date.now())-r.started)/1000)+'s · '+Math.round(r.bytes/1024)+' KB ';
                for (const [label,getBlob,ext] of [['Audio',()=>this.audio(r),r.mimeType?.includes('mp4')?'m4a':'webm'],['Telemetry',()=>new Blob([JSON.stringify({...r,blob:undefined})],{type:'application/json'}),'json']]) {
                    const btn = document.createElement('button'); btn.type='button'; btn.textContent=label;
                    btn.onclick=async()=>{ const blob=await getBlob(); const a=document.createElement('a'), url=URL.createObjectURL(blob); a.href=url;a.download=`harmony-${r.id}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000); };row.append(btn);
                }
                const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve(fn()).catch(e=>this.status(e.message));row.append(b);};
                const metrics={...this.metrics(r.events||[]),...(r.audioMetrics||{})};const detail=document.createElement('span');detail.textContent=' · '+JSON.stringify(metrics);row.append(detail);
                add('Analyze audio',async()=>{const ctx=new AudioContext();try{const data=await ctx.decodeAudioData(await (await this.audio(r)).arrayBuffer());if(data.numberOfChannels<2)throw new Error('Stereo capture required');const audioMetrics=HarmonySessionMetrics.analyzeEnvelope(data.getChannelData(0),data.getChannelData(1),data.sampleRate);if(r.id!==this.activeId&&!this.finalizing.has(r.id))await this.write({...r,audioMetrics});await this.review();}finally{await ctx.close();}});
                add('Copy summary',()=>navigator.clipboard.writeText(JSON.stringify({date:new Date(r.started).toISOString(),version:r.version,settings:r.settings,metrics},null,2)));
                if(r.id!==this.activeId&&!this.finalizing.has(r.id))add(r.keep?'Unkeep':'Keep',async()=>{await this.write({...r,keep:!r.keep});await this.review();});
                add('Export session',async()=>{const blob=await this.audio(r);const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});const url=URL.createObjectURL(new Blob([JSON.stringify({...r,metrics,audio:data,blob:undefined})],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`harmony-${r.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
                const del=document.createElement('button');del.type='button';del.textContent='Delete';del.disabled=r.id===this.activeId||this.finalizing.has(r.id);del.title=del.disabled?'Stop this session before deleting':'';del.onclick=async()=>{await this.write(r,true);await this.review();};row.append(del);const timeline=document.createElement('details'),title=document.createElement('summary'),pre=document.createElement('pre');title.textContent='Event timeline';pre.textContent=(r.events||[]).filter(e=>e.type!=='stats').map(e=>`${e.t}ms ${e.type} ${JSON.stringify(e)}`).join('\n');timeline.append(title,pre);row.append(timeline);list.append(row);
            }
        }
    }
    window.addEventListener('DOMContentLoaded', () => { window.harmonyDebug = new DebugSessions(document.getElementById('debugSessions')); });
})();
