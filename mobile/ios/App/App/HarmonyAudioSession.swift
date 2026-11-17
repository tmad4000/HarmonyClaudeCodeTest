import AVFoundation
import Capacitor
import UIKit
import WebKit

// Preserve Capacitor's UI delegate for every other selector; observe only capture.
private final class HarmonyCaptureDelegate: NSObject, WKUIDelegate {
    let original: WKUIDelegate
    static var decision: JSObject = ["decision": "not-requested"]
    init(_ original: WKUIDelegate) { self.original = original; super.init() }
    override func responds(to selector: Selector!) -> Bool { super.responds(to: selector) || original.responds(to: selector) }
    override func forwardingTarget(for selector: Selector!) -> Any? { original }
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let allowed = origin.protocol == "capacitor" && origin.host == "localhost" && frame.isMainFrame && type == .microphone
        Self.decision = ["decision": allowed ? "grant" : "deny", "protocol": origin.protocol,
                         "host": origin.host, "mainFrame": frame.isMainFrame, "type": Int(type.rawValue)]
        decisionHandler(allowed ? .grant : .deny)
    }
}

@objc(HarmonyViewController)
class HarmonyViewController: CAPBridgeViewController {
    private var captureDelegate: HarmonyCaptureDelegate?
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HarmonyAudioSession())
        if let delegate = webView?.uiDelegate {
            let capture = HarmonyCaptureDelegate(delegate)
            captureDelegate = capture
            webView?.uiDelegate = capture
        }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--harmony-smoke"), let content = webView?.configuration.userContentController {
            content.add(self, name: "harmonySmoke")
            let args = ProcessInfo.processInfo.arguments
            let selectedScript = args.contains("--harmony-byte-storage-probe") ? Self.byteStorageProbeScript : (args.contains("--harmony-output-probe") ? Self.outputProbeScript : Self.smokeScript)
            let phase = ["seed", "reopen", "recovery", "recovery-reopen", "recovery-events", "recovery-events-reopen", "off-held", "off-held-events", "migration-seed", "migration-reopen", "migration-stable"].first { args.contains("--harmony-byte-phase-" + $0) } ?? "seed"
            let rawNonce = ProcessInfo.processInfo.environment["HARMONY_QA_NONCE"] ?? ""
            let nonce = rawNonce.count == 32 && rawNonce.allSatisfy({ $0.isHexDigit }) ? rawNonce : "invalid"
            let script = selectedScript.replacingOccurrences(of: "const failureMode=false;", with: ProcessInfo.processInfo.arguments.contains("--harmony-mic-failure") ? "const failureMode=true;" : "const failureMode=false;").replacingOccurrences(of: "const realMic=false;", with: ProcessInfo.processInfo.arguments.contains("--harmony-real-mic") ? "const realMic=true;" : "const realMic=false;").replacingOccurrences(of: "const initialProtection=false;", with: ProcessInfo.processInfo.arguments.contains("--harmony-extra-protection") ? "const initialProtection=true;" : "const initialProtection=false;")
            let scopedScript = script.replacingOccurrences(of: "const phase='seed';", with: "const phase='\(phase)';").replacingOccurrences(of: "const qaNonce='draft';", with: "const qaNonce='\(nonce)';")
            content.addUserScript(WKUserScript(source: scopedScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
    }
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        return config
    }
}

/// No native DSP: controls the session around the unchanged Web Audio engine.
@objc(HarmonyAudioSession)
public class HarmonyAudioSession: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HarmonyAudioSession"
    public let jsName = "HarmonyAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openFeedback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNeural", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openPrivacy", returnType: CAPPluginReturnPromise)
    ]
    private var observers: [NSObjectProtocol] = []
    private var active = false
    public override func load() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let self else { return }
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
            // Category notifications include our own configuration and WebKit's changes.
            // Report those, but only stop for physical/sample-rate route changes.
            let physical = [UInt(1), UInt(2), UInt(4), UInt(6), UInt(8)].contains(reason)
            var data = self.route(); data["reason"] = Int(reason)
            self.notifyListeners(physical ? "routeChanged" : "sessionChanged", data: data)
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.interrupt("audio-interruption")
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.interrupt("background") })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in self?.interrupt("media-services-reset") })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
    private func configure() throws {
        let session = AVAudioSession.sharedInstance()
        // A2DP OUTPUT only; no allowBluetooth/HFP microphone and no mixWithOthers.
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.005)
        if let mic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
            try session.setPreferredInput(mic)
        }
        // WebKit owns activation after getUserMedia. Never reconfigure or
        // deactivate its live capture session from the native bridge.
    }
    private func deactivate() {
        active = false
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func interrupt(_ reason: String) {
        // Ask WebKit to stop synchronously as well as notifying JS listeners.
        webView?.evaluateJavaScript("window.harmonySinger?.stop();", completionHandler: nil)
        notifyListeners("interrupted", data: ["reason": reason])
        deactivate()
    }
    private func route() -> JSObject {
        let s = AVAudioSession.sharedInstance()
        let outputs = s.currentRoute.outputs
        let applicationPermission: String
        if #available(iOS 17.0, *) {
            let permission = AVAudioApplication.shared.recordPermission
            applicationPermission = permission == .granted ? "granted" : permission == .denied ? "denied" : "undetermined"
        } else { applicationPermission = "unavailable-before-iOS17" }
        let type: String
        if outputs.contains(where: { $0.portType == .builtInSpeaker || $0.portType == .builtInReceiver }) { type = "speaker" }
        else if outputs.contains(where: { [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE].contains($0.portType) }) { type = "bluetooth" }
        else if outputs.contains(where: { $0.portType == .usbAudio }) { type = "usb" }
        else { type = "wired" }
        let nativeBuild: JSObject = ["platform": "ios", "bundleId": Bundle.main.bundleIdentifier ?? "",
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "sessionOwner": "webkit"]
        return ["nativeBuild": nativeBuild, "outputType": type, "outputs": outputs.map { ["type": $0.portType.rawValue, "name": $0.portName] },
                "inputs": s.currentRoute.inputs.map { ["type": $0.portType.rawValue, "name": $0.portName] },
                "sampleRate": s.sampleRate, "bufferDuration": s.ioBufferDuration,
                "inputLatency": s.inputLatency, "outputLatency": s.outputLatency,
                "category": s.category.rawValue, "mode": s.mode.rawValue,
                "categoryOptions": Int(s.categoryOptions.rawValue), "active": active,
                "isInputAvailable": s.isInputAvailable, "applicationRecordPermission": applicationPermission,
                "recordPermission": s.recordPermission == .granted ? "granted" : s.recordPermission == .denied ? "denied" : "undetermined",
                "captureAuthorization": AVCaptureDevice.authorizationStatus(for: .audio).rawValue,
                "webViewCapture": HarmonyCaptureDelegate.decision]
    }
    private func configureCall(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try self.configure(); call.resolve(self.route()) }
            catch { self.deactivate(); call.reject("Audio session could not start: \(error.localizedDescription)") }
        }
    }
    @objc func prepare(_ call: CAPPluginCall) {
        // Obtain OS permission before activating an input session. WebKit capture
        // still checks its own permission via the scoped delegate above.
        DispatchQueue.main.async {
            let session = AVAudioSession.sharedInstance()
            if session.recordPermission == .denied {
                call.reject("Microphone permission denied: enable in Settings → Harmony", "MIC_PERMISSION_DENIED")
            } else if session.recordPermission == .undetermined {
                session.requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        if granted { self.configureCall(call) }
                        else { call.reject("Microphone permission denied: enable in Settings → Harmony", "MIC_PERMISSION_DENIED") }
                    }
                }
            } else { self.configureCall(call) }
        }
    }
    @objc func activate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = true
            UIApplication.shared.isIdleTimerDisabled = true
            call.resolve(self.route())
        }
    }
    @objc func release(_ call: CAPPluginCall) { DispatchQueue.main.async { self.deactivate(); call.resolve() } }
    @objc func getRoute(_ call: CAPPluginCall) { DispatchQueue.main.async { call.resolve(self.route()) } }
    @objc func openNeural(_ call: CAPPluginCall) { openPage("https://harmony.jacobcole.net/neural-experiment.html", call) }
    @objc func openPrivacy(_ call: CAPPluginCall) { openPage("https://harmony.jacobcole.net/privacy", call) }
    @objc func openFeedback(_ call: CAPPluginCall) { openPage("https://harmony-feedback.worldissuetracker.com", call) }
    private func openPage(_ address: String, _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.open(URL(string: address)!, options: [:]) { success in
                if success { call.resolve() } else { call.reject("Could not open feedback") }
            }
        }
    }
}

#if DEBUG
extension HarmonyViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "harmonySmoke", JSONSerialization.isValidJSONObject(message.body),
              let bytes = try? JSONSerialization.data(withJSONObject: message.body, options: [.prettyPrinted, .sortedKeys]),
              let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        try? bytes.write(to: folder.appendingPathComponent("harmony-smoke.json"), options: .atomic)
    }
    static let smokeScript = #"""
    (()=>{
      const failureMode=false;const realMic=false;
      const result={secureContext:window.isSecureContext,origin:location.origin,test:'native-default-recording-notice',syntheticMic:!realMic,realUploads:0,requests:[],paintedFrames:0,errors:[]};
      let firstPaint=null,done=false;
      const realFetch=window.fetch.bind(window);
      const visible=()=>{const n=document.getElementById('firstDebugNotice');if(!n)return false;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return !n.hidden&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&n.textContent.includes('Ideaflow');};
      const paint=()=>{if(visible()){result.paintedFrames++;firstPaint??=performance.now();}if(!done)requestAnimationFrame(paint);};requestAnimationFrame(paint);
      window.fetch=async(input,options)=>{const url=typeof input==='string'?input:input.url;if(url.includes('globalbr.ai/api/ingest/harmony/v1')){result.requests.push({path:new URL(url).pathname,method:input instanceof Request?input.method:options?.method||'GET',at:performance.now(),noticeVisible:visible(),paintedFrames:result.paintedFrames});return new Response(JSON.stringify({error:'synthetic_smoke_no_network'}),{status:503,headers:{'Content-Type':'application/json'}});}return realFetch(input,options);};
      window.addEventListener('error',e=>result.errors.push(e.message));
      const report=()=>{if(done)return;done=true;window.harmonySinger?.stop();result.firstPaint=firstPaint;result.defaultRecordingOn=window.harmonyDebug?.enabled===true;result.nativeRoute=window.harmonyNativeRoute;result.running=window.harmonySinger?.isRunning;result.lastError=String(window.harmonySinger?.lastError||'');result.micFailures=window.harmonySinger?.getLog().filter(e=>e.type==='mic-start-failed');result.pass=result.errors.length===0&&result.beforeSingRequests===0&&result.defaultRecordingOn&&result.requests.length>0&&(failureMode?result.micFailures?.some(e=>e.name==='NotAllowedError'&&e.capture?.constraints?.audio):result.beforeStop?.running===true&&result.beforeStop?.liveAudio===true&&result.beforeStop?.sourceAssigned===true&&result.beforeStop?.sourceContextMatches===true&&(!realMic||result.nativeRoute?.webViewCapture?.decision==='grant')&&!result.lastError&&result.micFailures?.length===0)&&result.requests.every(r=>r.paintedFrames>1&&firstPaint!==null&&r.at>firstPaint);window.webkit.messageHandlers.harmonySmoke.postMessage(result);};
      window.addEventListener('DOMContentLoaded',()=>{
        // Install before the native adapter's DOM listener wraps capture.
        if(!realMic)navigator.mediaDevices.getUserMedia=async()=>{if(failureMode)throw new DOMException('Synthetic permission failure','NotAllowedError');const c=Tone.getContext().rawContext,o=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();o.frequency.value=220;g.gain.value=.015;o.connect(g).connect(d);o.start();return d.stream;};
        setTimeout(async()=>{try{
        result.beforeSingRequests=result.requests.length;
        document.getElementById('startBtn').click();
        setTimeout(()=>{const h=window.harmonySinger;result.beforeStop={running:h?.isRunning,liveAudio:h?.mediaStream?.getAudioTracks().some(t=>t.readyState==='live')===true,sourceAssigned:typeof h?.micSource?.connect==='function',sourceContextMatches:h?.micSource?.context===h?.audioContext};h?.stop();},5000);
        setTimeout(report,10000);
      }catch(e){result.errors.push(String(e));report();}},1500);});
      setTimeout(report,20000);
    })();
    """#
}
#if DEBUG
extension HarmonyViewController {
    static let outputProbeScript = #"""
    (()=>{
     const initialProtection=false;
    const result={test:'build5-WK-output-while-real-capture',realCapture:false,syntheticStimulus:true,realUploads:0,requests:[],samples:[],sessionPhases:[],processorErrors:[],errors:[]};
     const realFetch=window.fetch.bind(window),realGUM=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let realStream,oscillators=[],finished=false;
     window.fetch=async(input,options)=>{const u=typeof input==='string'?input:input.url;if(u.includes('globalbr.ai/api/ingest/harmony/v1')){result.requests.push({path:new URL(u).pathname,method:input instanceof Request?input.method:options?.method||'GET'});return new Response('{"error":"output_probe_no_network"}',{status:503,headers:{'Content-Type':'application/json'}});}return realFetch(input,options);};
     window.addEventListener('error',e=>result.errors.push(e.message));
     const sleep=ms=>new Promise(r=>setTimeout(r,ms));
     const meterBuffers=new WeakMap();
     const rmsOf=node=>{if(!node?.getFloatTimeDomainData)return null;let b=meterBuffers.get(node);if(!b||b.length!==node.fftSize){b=new Float32Array(node.fftSize);meterBuffers.set(node,b);}node.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((n,x)=>n+x*x,0)/b.length);};
     const observeProcessors=h=>{for(const [voice,node] of [...Object.entries(h.pitchShifters||{}),['aec',h.aecNode]]){node?.addEventListener?.('processorerror',e=>{if(result.processorErrors.length<20)result.processorErrors.push({node:voice,at:performance.now(),message:String(e.message||'processorerror').slice(0,160)});});}result.shifterNodes=Object.fromEntries(Object.entries(h.pitchShifters||{}).map(([k,n])=>[k,{inputs:n.numberOfInputs,outputs:n.numberOfOutputs,contextState:n.context?.state||null}]));};
    const probeRecordedChunk=async()=>{
     const out=result.recordedChunkPreparation={input:'generated stimulus only; real capture disconnected',origin:location.origin,isSecureContext:window.isSecureContext};let stage='local-chunk-read';
     try{
      const d=window.harmonyDebug,id=d?.activeId;out.recorderMimeType=d?.recorder?.mimeType;out.recorderState=d?.recorder?.state;
      if(!id)throw new Error('No active generated-stimulus debug session');
      const db=await d.db,read=(database,store)=>new Promise((resolve,reject)=>{const r=database.transaction(store).objectStore(store).index('session').getAll(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const isBytes=v=>v instanceof ArrayBuffer||ArrayBuffer.isView(v),byteSize=v=>isBytes(v)?v.byteLength:v?.size||0;const chunks=await read(db,'chunks');out.localChunkCount=chunks.length;out.localChunkSizes=chunks.map(c=>byteSize(c.data??c.blob));out.localChunkTypes=Array.from(new Set(chunks.map(c=>c.mimeType||c.blob?.type||out.recorderMimeType)));out.localByteBacked=chunks.length>0&&chunks.every(c=>isBytes(c.data)&&!c.blob);
      const transfer=await harmonyDebugUpload.store.db,tasks=(await read(transfer,'tasks')).filter(t=>t.type==='audio');out.queuedAudioTasks=tasks.length;
      const task=tasks[0];if(!task)throw new Error('No generated-stimulus audio in existing outbox');const payload=t=>t.data??t.body;out.outboxByteBacked=tasks.every(t=>isBytes(payload(t)));
      out.chunkBytes=byteSize(payload(task));out.blobType=payload(task) instanceof Blob?payload(task).type:'';out.requestMime=task.mime;out.instanceOfBlob=payload(task) instanceof Blob;out.byteBacked=isBytes(payload(task));
      stage=out.byteBacked?'byte-buffer':'blob-arraybuffer';const bytes=out.byteBacked?(payload(task) instanceof ArrayBuffer?payload(task).slice(0):new Uint8Array(payload(task).buffer,payload(task).byteOffset,payload(task).byteLength).slice().buffer):await payload(task).arrayBuffer();out.arrayBufferBytes=bytes.byteLength;
      stage='sha256';const hash=await crypto.subtle.digest('SHA-256',bytes);out.sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
      stage='request-construction';const request=new Request('https://globalbr.ai/api/ingest/harmony/v1/sessions/probe/chunks/probe',{method:'PUT',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':task.mime,'X-Chunk-Kind':'audio','X-Upload-Epoch':'0'},body:new Blob([bytes],{type:task.mime})});out.requestContentType=request.headers.get('Content-Type');out.requestConstructed=true;out.fetchCalled=false;
     }catch(error){out.stage=stage;out.error={name:error.name,message:String(error.message)};}
    };
     const finish=async()=>{if(finished)return;finished=true;try{result.captureLiveAtFinish=realStream?.getAudioTracks().some(t=>t.readyState==='live')===true;result.native=await window.Capacitor.Plugins.HarmonyAudioSession.getRoute();}catch(e){result.errors.push(String(e));}result.currentAttemptErrors=(window.harmonySinger?.getLog?.()||[]).filter(e=>['warning','audio-error'].includes(e.type)).map(e=>({type:e.type,t:e.t,message:String(e.message||e.error||'').slice(0,200)}));window.harmonySinger?.stop();realStream?.getTracks().forEach(t=>t.stop());oscillators.forEach(o=>{try{o.stop();}catch(_){}});window.webkit.messageHandlers.harmonySmoke.postMessage(result);};
     const sample=async(phase,ms,direct)=>{const h=window.harmonySinger,c=h.audioContext,start=performance.now();result.sessionPhases.push({phase,point:'start',at:performance.now(),native:await window.Capacitor.Plugins.HarmonyAudioSession.getRoute()});while(performance.now()-start<ms){const levels=h.debugAudioLevels();let directRms=null;if(direct){const x=new Float32Array(direct.fftSize);direct.getFloatTimeDomainData(x);directRms=Math.sqrt(x.reduce((a,v)=>a+v*v,0)/x.length);}result.samples.push({phase,at:performance.now(),time:c.currentTime,...levels,directRms,processedInputRms:rmsOf(h.pitchAnalyser),inputAnalyserRms:rmsOf(h.analyser),voiceRms:Object.fromEntries(Object.entries(h.voiceAnalysers||{}).map(([v,a])=>[v,rmsOf(a)])),voiceShifts:{...h.voiceShifts},aecStats:Object.fromEntries(['outPow','micPow','echoPow','refPow','doubleTalk','adapted','renderGaps','missingInputBlocks','quantum','leak','micDb','outDb','echoDb'].filter(k=>typeof h.aecStats?.[k]==='number'||typeof h.aecStats?.[k]==='boolean').map(k=>[k,h.aecStats[k]])),destinationMute:Tone.getDestination().mute,destinationVolume:Tone.getDestination().volume.value,engine:h.engine,echoMode:h.echoMode,pitch:h.lastPitch,stableMidi:h.stableMidi,masterGain:h.masterGain?.gain?.value,gateGain:h.gateGain?.gain?.value,trimGain:h.trimGain?.gain?.value,extraProtection:h.extraProtection,harmonyVolume:h.harmonyVolume,voiceGains:Object.fromEntries(Object.entries(h.gains).map(([k,v])=>[k,v.gain.value])),sourceContextMatches:h.micSource?.context===c,captureLive:realStream?.getAudioTracks().some(t=>t.readyState==='live')===true,captureMuted:realStream?.getAudioTracks()[0]?.muted,captureEnabled:realStream?.getAudioTracks()[0]?.enabled});await sleep(100);}result.sessionPhases.push({phase,point:'end',at:performance.now(),native:await window.Capacitor.Plugins.HarmonyAudioSession.getRoute()});};
     window.addEventListener('DOMContentLoaded',()=>{
      navigator.mediaDevices.getUserMedia=async constraints=>{realStream=await realGUM(constraints);result.realCapture=realStream.getAudioTracks().some(t=>t.readyState==='live');const c=Tone.getContext().rawContext,d=c.createMediaStreamDestination(),mix=c.createGain();mix.gain.value=.04;mix.connect(d);for(const [multiple,weight] of [[1,1],[2,.5],[3,.25]]){const o=c.createOscillator(),g=c.createGain();o.frequency.value=220*multiple;g.gain.value=weight;o.connect(g).connect(mix);o.start();oscillators.push(o);}return d.stream;};
      setTimeout(async()=>{try{const h=window.harmonySinger;h.setSpeakerMode(true);h.setExtraProtection(initialProtection);document.getElementById('startBtn').click();for(let i=0;i<150;i++){if(h.lastError)throw h.lastError;if(h.isRunning&&!h.starting&&!h.calibrating&&window.harmonyNativeRoute?.active)break;await sleep(100);}if(!h.isRunning||h.starting||h.calibrating||!window.harmonyNativeRoute?.active)throw new Error('engine/native activation readiness timeout');observeProcessors(h);result.chunkPreparation={origin:location.origin,href:location.href,isSecureContext:window.isSecureContext,digestType:typeof globalThis.crypto?.subtle?.digest,blobArrayBufferType:typeof Blob.prototype.arrayBuffer};try{const bytes=await new Blob(['abc'],{type:'application/octet-stream'}).arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);result.chunkPreparation.sha256=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');result.chunkPreparation.matchesKnownSha256=result.chunkPreparation.sha256==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';}catch(error){result.chunkPreparation.error={name:error.name,message:String(error.message)};}result.initialExtraProtection=h.extraProtection;await sample('normal',2000);h.setDebugContinuous(true);await sample('continuous',3500);h.setExtraProtection(true);await sample('continuous-forced-protection',3500);h.setExtraProtection(false);await sample('continuous-web-default-protection',3500);const c=h.audioContext,o=c.createOscillator(),g=c.createGain(),a=c.createAnalyser();o.frequency.value=440;g.gain.value=.005;o.connect(g);g.connect(a);g.connect(c.destination);o.start();oscillators.push(o);await sample('direct-plus-harmony',1000,a);o.stop();g.disconnect();await probeRecordedChunk();result.lastError=String(h.lastError||'');result.contextAfter={state:c.state,currentTime:c.currentTime};await finish();}catch(e){result.errors.push(String(e?.stack||e));await finish();}},1500);
     });
     setTimeout(()=>{result.errors.push('probe deadline');finish();},30000);
    })();
    """#
}
#endif

#endif

#if DEBUG
extension HarmonyViewController {
    static let byteStorageProbeScript = #"""
    /* DEBUG-only native QA. Generated bytes, task-owned simulator data, all HTTP intercepted. */
    (()=>{
     const phase='seed';const qaNonce='draft';
     Object.defineProperty(window,'HARMONY_DEBUG_UPLOAD_ENABLED',{configurable:true,get:()=>false,set:()=>{}});
     const result={test:'native-byte-storage',phase,qaNonce,origin:location.origin,secureContext:isSecureContext,realUploads:0,microphoneCalls:0,enrollmentCalls:0,requests:[],errors:[]};
     const originalFetch=window.fetch.bind(window),originalRead=Blob.prototype.arrayBuffer;
     const sleep=ms=>new Promise(r=>setTimeout(r,ms));let transfer,local,context,done=false;
     const check=(ok,label)=>{if(!ok)throw new Error(label);};
     const isBytes=v=>v instanceof ArrayBuffer||ArrayBuffer.isView(v);
     const payload=t=>t.data??t.body;
     const bytes=v=>v instanceof ArrayBuffer?new Uint8Array(v):new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
     const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',isBytes(v)?bytes(v):v)),x=>x.toString(16).padStart(2,'0')).join('');
     const all=async(store,name)=>{const db=await store.db;return await new Promise((r,j)=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});};
     const noBlob=v=>!(v instanceof Blob)&&(isBytes(v)||!v||typeof v!=='object'||Object.values(v).every(noBlob));
     const waitFor=async(fn,label)=>{for(let n=0;n<100;n++){if(fn())return;await sleep(50);}throw new Error(label);};
     if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{result.microphoneCalls++;throw new Error('QA microphone prohibited');};
     window.fetch=async(input,options)=>{
      const req=input instanceof Request?input:new Request(input,options),url=new URL(req.url);
      if(url.protocol==='capacitor:')return originalFetch(req);
      if(url.origin!=='https://globalbr.ai')throw new Error('QA external network prohibited');
      const row={method:req.method,path:url.pathname};result.requests.push(row);
      if(req.method==='POST'){result.enrollmentCalls++;throw new Error('QA enrollment prohibited');}
      const id=url.pathname.split('/').at(-1);
      if(url.pathname.includes('/chunks/')){const body=await req.arrayBuffer();row.bytes=body.byteLength;row.sha256=await digest(body);row.contentType=req.headers.get('Content-Type');return new Response(JSON.stringify({id,bytes:row.bytes,sha256:row.sha256}),{status:200,headers:{'Content-Type':'application/json'}});}
      if(req.method==='PUT'){const body=await req.json();row.complete=body.complete;row.lostReport=body.complete===undefined&&body.metadata?.uploadDiagnostic?.lostOnDevice===true;row.localPayloadLoss=body.metadata?.localPayloadLoss||null;return new Response(JSON.stringify({id,epoch:0,saved:true}),{status:200,headers:{'Content-Type':'application/json'}});}
      throw new Error('Unexpected QA request');
     };
     window.addEventListener('error',e=>result.errors.push(String(e.message)));
     const finish=async()=>{if(done)return;done=true;try{if(transfer){clearTimeout(transfer.timer);clearInterval(transfer.maintenance);transfer.channel?.close();(await transfer.store.db).close();}if(local)(await local.db).close();if(context)await context.close();}catch(e){result.errors.push('cleanup: '+String(e.message));}result.pass=result.errors.length===0&&result.microphoneCalls===0&&result.enrollmentCalls===0;window.webkit.messageHandlers.harmonySmoke.postMessage(result);};
     const setup=async()=>{
      await waitFor(()=>window.HarmonyNoosTransfer&&window.LocalSessionStore&&window.harmonyDebug,'QA classes not loaded');
      const C=window.HarmonyNoosTransfer.NoosDebugTransfer;C.prototype.schedule=function(){};
      transfer=new C(window.harmonyDebug,'https://globalbr.ai/api/ingest/harmony/v1');window.harmonyDebugUpload=transfer;
      await transfer.ready;await waitFor(()=>transfer.noticed===true,'visible beta notice not painted');
      await transfer.store.config('device',{deviceId:'00000000000000000000000000000000',token:'qa-only-never-transmitted',epoch:0,limits:{chunkBytes:2097152}});
      await transfer.syncControl();check(transfer.accepting&&transfer.noticed,'fixture authorization missing');
      local=new LocalSessionStore('harmony-native-byte-qa');
     };
     const record=async()=>{
      context=new AudioContext();await context.resume();const o=context.createOscillator(),g=context.createGain(),d=context.createMediaStreamDestination();let rec;
      try{o.frequency.value=220;g.gain.value=.01;o.connect(g).connect(d);o.start();
       const mime=['audio/webm;codecs=opus','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));rec=new MediaRecorder(d.stream,{mimeType:mime,audioBitsPerSecond:96000});let read;
       rec.ondataavailable=e=>{if(e.data.size&&!read)read=e.data.arrayBuffer().then(data=>({data:new Uint8Array(data),mimeType:rec.mimeType||e.data.type}));};
       await new Promise((r,j)=>{rec.onstop=r;rec.onerror=e=>j(e.error||new Error('QA recorder failed'));rec.start();setTimeout(()=>{if(rec.state!=='inactive')rec.stop();},500);});
       check(!!read,'no generated encoder bytes');return await read;
      }finally{if(rec?.state==='recording')try{rec.stop();}catch(_){}try{o.stop();}catch(_){}o.disconnect();g.disconnect();d.stream.getTracks().forEach(t=>t.stop());d.disconnect();}
     };
     const seed=async()=>{
      const encoded=await record(),id='native-byte-roundtrip',row={id,started:Date.now(),events:[{type:'start',t:1}],bytes:encoded.data.byteLength,mimeType:encoded.mimeType,settings:{speakerMode:true}},control=await transfer.store.get('config','control');
      await local.write(row,false,{id:id+':0',session:id,index:0,data:encoded.data,mimeType:encoded.mimeType});
      await transfer.store.append(row,{index:0,data:encoded.data,mimeType:encoded.mimeType},true,{fixture:'generated-byte-roundtrip'},control.generation);
      const expected={id,bytes:encoded.data.byteLength,sha256:await digest(encoded.data),mimeType:encoded.mimeType};await transfer.store.config('native-byte-qa',expected);
      const chunks=await all(local,'chunks'),tasks=await all(transfer.store,'tasks');check(chunks.length===1&&isBytes(chunks[0].data)&&noBlob(chunks),'local store retained Blob');check(tasks.some(t=>t.type==='audio')&&tasks.filter(t=>['audio','events'].includes(t.type)).every(t=>isBytes(payload(t))&&isBytes(t.data)&&t.ready===2&&noBlob(t)),'outbox retained Blob');
      check(tasks.filter(t=>!t.type.startsWith('delete')).every(t=>t.formatVersion===2&&t.ready===2&&t.generation==='v2:'+control.generation),'whole-session opaque generation/ready2 missing');const session=await transfer.store.get('sessions',id);check(session.formatVersion===2&&session.generation==='v2:'+control.generation,'session generation not protected');result.wholeSessionProtected=true;result.expected=expected;result.localByteOnly=true;result.outboxByteOnly=true;result.persistedBeforeProcessStop=true;
     };
     const reopen=async()=>{
      const expected=await transfer.store.get('config','native-byte-qa');check(expected?.id,'cold fixture missing');const rows=await local.rows(),row=rows.find(r=>r.id===expected.id);check(row,'local row missing after relaunch');
      const rebuilt=await local.audio(row),data=await rebuilt.arrayBuffer();check(rebuilt.type===expected.mimeType,'local reconstructed MIME changed');check(data.byteLength===expected.bytes&&await digest(data)===expected.sha256,'local reconstructed bytes changed after relaunch');
      const tasks=await all(transfer.store,'tasks'),audio=tasks.find(t=>t.type==='audio'&&t.session===expected.id);check(audio&&isBytes(payload(audio))&&noBlob(audio),'outbox not bytes after relaunch');check(sizeOf(payload(audio))===expected.bytes&&await digest(payload(audio))===expected.sha256,'outbox bytes changed after relaunch');
      const request=new Request('https://example.invalid/no-fetch',{method:'PUT',headers:{'Content-Type':audio.mime},body:new Blob([bytes(payload(audio))],{type:audio.mime})});check(request.headers.get('Content-Type')===expected.mimeType,'reconstructed request MIME changed');
      result.expected=expected;result.relaunchRoundtrip=true;result.requestContentType=request.headers.get('Content-Type');result.noBlobPersisted=tasks.filter(t=>['audio','events'].includes(t.type)).every(noBlob);check(result.noBlobPersisted,'legacy Blob in fresh byte fixture');
     };
     const sizeOf=v=>isBytes(v)?v.byteLength:v.size;
     const migration=async()=>{
      const id='native-mixed-migration',c=await transfer.store.get('config','control');
      const describe=async tasks=>Promise.all(tasks.map(async t=>({id:t.id,type:t.type,remote:t.remote??null,priority:t.priority,epoch:t.epoch,bytes:t.bytes,mime:t.mime??null,sha256:isBytes(payload(t))?await digest(payload(t)):JSON.stringify(payload(t))})));
      if(phase==='migration-seed'){
       const data=new Uint8Array([1,2,3,4]),row={id,started:Date.now(),events:[{type:'start',t:1}],bytes:4,mimeType:'audio/mp4'};
       await transfer.store.append(row,{index:0,data,mimeType:row.mimeType},true,{fixture:'mixed-migration'},c.generation);
       await transfer.store.append({...row,bytes:8},{index:1,data:new Uint8Array([5,6,7,8]),mimeType:row.mimeType},true,{fixture:'mixed-migration'},c.generation);
       const tasks=(await all(transfer.store,'tasks')).filter(t=>t.session===id);check(tasks.length>=4,'mixed fixture incomplete');
       await transfer.store.change(['tasks','sessions','config'],tx=>{const legacy={...tasks[0],generation:c.generation,ready:1};delete legacy.formatVersion;tx.objectStore('tasks').put(legacy);const q=tx.objectStore('sessions').get(id);q.onsuccess=()=>{const v={...q.result,generation:c.generation};delete v.formatVersion;tx.objectStore('sessions').put(v);};tx.objectStore('config').put({...c,block:Date.now()+600000},'control');});
       const expected={tasks:await describe((await all(transfer.store,'tasks')).filter(t=>t.session===id)),generation:c.generation,epoch:c.epoch,block:(await transfer.store.get('config','control')).block};await transfer.store.config('native-migration-qa',expected);result.mixedLegacyPersisted=true;
      }else{
       const expected=await transfer.store.get('config','native-migration-qa'),tasks=(await all(transfer.store,'tasks')).filter(t=>t.session===id),actual=await describe(tasks);check(expected&&tasks.length===expected.tasks.length,'migration row count changed');
       check(tasks.every(t=>t.formatVersion===2&&t.ready===2&&t.generation==='v2:'+expected.generation),'migration generation/ready changed');
       check(JSON.stringify(actual.map(({id,...v})=>v))===JSON.stringify(expected.tasks.map(({id,...v})=>v)),'migration order/wire/bytes/MIME/epoch changed');
       const control=await transfer.store.get('config','control');check(control.generation===expected.generation&&control.epoch===expected.epoch&&control.block===expected.block,'migration control/backoff changed');
       if(phase==='migration-reopen'){check(actual.every(t=>!expected.tasks.some(old=>old.id===t.id)),'held old receipt local IDs reused');await transfer.store.config('native-migration-stable',actual.map(t=>t.id));result.coldMigrationVerified=true;}
       else{check(JSON.stringify(actual.map(t=>t.id))===JSON.stringify(await transfer.store.get('config','native-migration-stable')),'protected IDs rekeyed again');result.migrationStableAfterRelaunch=true;}
       check(result.requests.length===0,'migration sent network request');
      }
     };
     const recovery=async()=>{
      const lossKind=phase==='recovery-events'?'events':'audio';result.lossKind=lossKind;const c=await transfer.store.get('config','control'),badId='native-legacy-loss-'+lossKind,goodId='native-after-loss-'+lossKind,data=new TextEncoder().encode('generated byte fixture only');
      for(const id of [badId,goodId]){const row={id,started:Date.now(),events:[{type:'start',t:1}],bytes:data.byteLength,mimeType:'audio/webm;codecs=opus'};await transfer.store.append(row,{index:0,data,mimeType:row.mimeType},true,{fixture:id},c.generation);}
      const tasks=await all(transfer.store,'tasks'),bad=tasks.find(t=>t.session===badId&&t.type===lossKind);check(bad,'legacy fixture task missing');const healthyEvent=tasks.find(t=>t.session===goodId&&t.type==='events');check(healthyEvent&&isBytes(payload(healthyEvent)),'healthy event fixture missing');const eventExpected={bytes:payload(healthyEvent).byteLength,sha256:await digest(payload(healthyEvent)),remote:healthyEvent.remote,mime:healthyEvent.mime};
      await transfer.store.change(['tasks'],tx=>tx.objectStore('tasks').put({...bad,data:undefined,body:new Blob([bytes(payload(bad))],{type:bad.mime}),ready:1}));
      const doomed=new WeakSet(),authorize=transfer.store.authorize.bind(transfer.store);transfer.store.authorize=async(...args)=>{const claim=await authorize(...args);if(claim?.task?.id===bad.id&&claim.task.body instanceof Blob)doomed.add(claim.task.body);return claim;};
      Blob.prototype.arrayBuffer=function(){if(doomed.has(this)){result.injectedLegacyReadAttempts=(result.injectedLegacyReadAttempts||0)+1;return Promise.reject(new DOMException('Synthetic absent backing file','NotFoundError'));}return originalRead.call(this);};
      try{for(let n=0;n<6;n++){await transfer.drain();if(!await transfer.store.next())break;}const lost=await transfer.store.get('tasks',bad.id);check(!lost,'lost task not removed');const lossSession=await transfer.store.get('sessions',badId);check(lossSession?.localPayloadLoss?.reason==='lost-on-device'&&lossSession.localPayloadLoss.chunks===1&&lossSession.localPayloadLoss.bytes===bad.bytes&&lossSession.localPayloadLoss.lastKind===lossKind&&lossSession.localPayloadLoss.lastChunk===bad.remote,'session loss ledger missing');
       const before=result.requests.filter(r=>r.lostReport).length;check(before===1,'lost diagnostic not reported exactly once');const expectedSha=await digest(data);check(result.requests.some(r=>r.path.includes('/'+goodId+'/chunks/')&&r.bytes===data.byteLength&&r.sha256===expectedSha&&r.contentType==='audio/webm;codecs=opus'),'healthy later session bytes/hash/MIME incorrect or blocked');check(result.requests.some(r=>r.path.includes('/'+goodId+'/chunks/')&&r.path.endsWith('/'+eventExpected.remote)&&r.bytes===eventExpected.bytes&&r.sha256===eventExpected.sha256&&r.contentType===eventExpected.mime),'healthy successor event bytes/hash/MIME incorrect or blocked');result.healthyEventsAfterLoss=true;check(result.injectedLegacyReadAttempts===1,'legacy payload read repeated');
       await transfer.store.retryFailed();for(let n=0;n<3;n++)await transfer.drain();const again=await transfer.store.get('tasks',bad.id);check(!again,'Retry revived lost bytes');check(result.requests.filter(r=>r.lostReport).length===before,'Retry repeated loss report');
       await transfer.store.config('native-loss-qa',{session:badId,taskId:bad.id,kind:lossKind});result.lossTerminalOnce=true;result.lossReports=before;result.healthyAfterLoss=true;result.retryDoesNotRevive=true;result.noReadyTasks=(await transfer.store.next())===null;check(result.noReadyTasks,'unexpected ready FIFO task remains');
      }finally{Blob.prototype.arrayBuffer=originalRead;}
     };
     const recoveryReopen=async()=>{
      const expected=await transfer.store.get('config','native-loss-qa');result.lossKind=expected?.kind;check(expected?.taskId,'cold loss fixture missing');
      const lost=await transfer.store.get('tasks',expected.taskId);check(!lost,'cold relaunch revived lost task');
      const session=await transfer.store.get('sessions',expected.session);check(session?.localPayloadLoss?.reason==='lost-on-device','cold loss metadata absent');
      await transfer.store.retryFailed();await transfer.drain();check(!await transfer.store.get('tasks',expected.taskId),'cold Retry revived loss');check(result.requests.length===0,'cold loss retry re-reported or uploaded');
      result.lossSurvivesRelaunch=true;result.noRepeatedReport=true;
     };
     const offHeld=async()=>{
      const lossKind=phase==='off-held-events'?'events':'audio';result.lossKind=lossKind;const c=await transfer.store.get('config','control'),id='native-held-off-'+lossKind,data=new TextEncoder().encode('generated held fixture');
      await transfer.store.append({id,started:Date.now(),events:lossKind==='events'?[{type:'start',t:1}]:[],bytes:data.byteLength,mimeType:'audio/webm;codecs=opus'},{index:0,data,mimeType:'audio/webm;codecs=opus'},true,{fixture:'held-off'},c.generation);
      const task=(await all(transfer.store,'tasks')).find(t=>t.session===id&&t.type===lossKind);check(task,'held fixture task missing');await transfer.store.change(['tasks'],tx=>tx.objectStore('tasks').put({...task,data:undefined,body:new Blob([bytes(payload(task))],{type:task.mime}),ready:1}));
      const doomed=new WeakSet(),authorize=transfer.store.authorize.bind(transfer.store);let rejectRead;
      transfer.store.authorize=async(...args)=>{const q=await authorize(...args);if(q?.task?.id===task.id&&q.task.body instanceof Blob)doomed.add(q.task.body);return q;};
      Blob.prototype.arrayBuffer=function(){if(doomed.has(this))return new Promise((resolve,reject)=>{rejectRead=reject;});return originalRead.call(this);};
      try{const draining=transfer.drain();await waitFor(()=>!!rejectRead,'held legacy read not entered');window.harmonyDebug.enabled=false;await transfer.setEnabled(false);const count=result.requests.length;rejectRead(new DOMException('Synthetic lost file after Off','NotFoundError'));await draining;await sleep(50);check(result.requests.length===count,'Off allowed stale report/upload');check(!await transfer.store.get('tasks',task.id),'Off resurrected pending task');check(!result.requests.some(r=>r.lostReport),'Off emitted stale loss diagnostic');result.offDuringReadFenced=true;
      }finally{Blob.prototype.arrayBuffer=originalRead;}
     };
     window.addEventListener('DOMContentLoaded',()=>setTimeout(async()=>{try{await setup();if(phase.startsWith('migration-'))await migration();else if(phase==='seed')await seed();else if(phase==='reopen')await reopen();else if(['recovery','recovery-events'].includes(phase))await recovery();else if(['recovery-reopen','recovery-events-reopen'].includes(phase))await recoveryReopen();else if(['off-held','off-held-events'].includes(phase))await offHeld();else throw new Error('Unknown QA phase');}catch(e){result.errors.push(String(e.stack||e));}await finish();},500));
     setTimeout(()=>{if(!done){result.errors.push('native byte QA deadline');finish();}},25000);
    })();
    """#
}
#endif
