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
            let selectedScript = ProcessInfo.processInfo.arguments.contains("--harmony-output-probe") ? Self.outputProbeScript : Self.smokeScript
            let script = selectedScript.replacingOccurrences(of: "const failureMode=false;", with: ProcessInfo.processInfo.arguments.contains("--harmony-mic-failure") ? "const failureMode=true;" : "const failureMode=false;").replacingOccurrences(of: "const realMic=false;", with: ProcessInfo.processInfo.arguments.contains("--harmony-real-mic") ? "const realMic=true;" : "const realMic=false;")
            content.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
    private func configure(activate: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        // A2DP OUTPUT only; no allowBluetooth/HFP microphone and no mixWithOthers.
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.005)
        if let mic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
            try session.setPreferredInput(mic)
        }
        // WebKit acquires capture first; activating here during prepare can
        // interrupt that handoff. Reapply/activate only after the graph is ready.
        if activate {
            try session.setActive(true)
            active = true
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }
    private func deactivate() {
        active = false
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
        return ["outputType": type, "outputs": outputs.map { ["type": $0.portType.rawValue, "name": $0.portName] },
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
    private func configureCall(_ call: CAPPluginCall, activate: Bool = true) {
        DispatchQueue.main.async {
            do { try self.configure(activate: activate); call.resolve(self.route()) }
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
                        if granted { self.configureCall(call, activate: false) }
                        else { call.reject("Microphone permission denied: enable in Settings → Harmony", "MIC_PERMISSION_DENIED") }
                    }
                }
            } else { self.configureCall(call, activate: false) }
        }
    }
    @objc func activate(_ call: CAPPluginCall) { configureCall(call) }
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
      window.fetch=async(input,options)=>{const url=typeof input==='string'?input:input.url;if(url.includes('globalbr.ai/api/ingest/harmony/v1')){result.requests.push({path:new URL(url).pathname,method:options?.method||'GET',at:performance.now(),noticeVisible:visible(),paintedFrames:result.paintedFrames});return new Response(JSON.stringify({error:'synthetic_smoke_no_network'}),{status:503,headers:{'Content-Type':'application/json'}});}return realFetch(input,options);};
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
     const result={test:'build4-WK-output-while-real-capture',realCapture:false,syntheticStimulus:true,realUploads:0,requests:[],samples:[],sessionPhases:[],errors:[]};
     const realFetch=window.fetch.bind(window),realGUM=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let realStream,oscillators=[],finished=false;
     window.fetch=async(input,options)=>{const u=typeof input==='string'?input:input.url;if(u.includes('globalbr.ai/api/ingest/harmony/v1')){result.requests.push({path:new URL(u).pathname,method:options?.method||'GET'});return new Response('{"error":"output_probe_no_network"}',{status:503,headers:{'Content-Type':'application/json'}});}return realFetch(input,options);};
     window.addEventListener('error',e=>result.errors.push(e.message));
     const sleep=ms=>new Promise(r=>setTimeout(r,ms));
     const finish=async()=>{if(finished)return;finished=true;try{result.captureLiveAtFinish=realStream?.getAudioTracks().some(t=>t.readyState==='live')===true;result.native=await window.Capacitor.Plugins.HarmonyAudioSession.getRoute();}catch(e){result.errors.push(String(e));}window.harmonySinger?.stop();realStream?.getTracks().forEach(t=>t.stop());oscillators.forEach(o=>{try{o.stop();}catch(_){}});window.webkit.messageHandlers.harmonySmoke.postMessage(result);};
     const sample=async(phase,ms,direct)=>{const h=window.harmonySinger,c=h.audioContext,start=performance.now();result.sessionPhases.push({phase,point:'start',at:performance.now(),native:await window.Capacitor.Plugins.HarmonyAudioSession.getRoute()});while(performance.now()-start<ms){const levels=h.debugAudioLevels();let directRms=null;if(direct){const x=new Float32Array(direct.fftSize);direct.getFloatTimeDomainData(x);directRms=Math.sqrt(x.reduce((a,v)=>a+v*v,0)/x.length);}result.samples.push({phase,at:performance.now(),time:c.currentTime,...levels,directRms,destinationMute:Tone.getDestination().mute,destinationVolume:Tone.getDestination().volume.value,engine:h.engine,echoMode:h.echoMode,pitch:h.lastPitch,stableMidi:h.stableMidi,masterGain:h.masterGain?.gain?.value,gateGain:h.gateGain?.gain?.value,trimGain:h.trimGain?.gain?.value,extraProtection:h.extraProtection,harmonyVolume:h.harmonyVolume,voiceGains:Object.fromEntries(Object.entries(h.gains).map(([k,v])=>[k,v.gain.value])),sourceContextMatches:h.micSource?.context===c,captureLive:realStream?.getAudioTracks().some(t=>t.readyState==='live')===true,captureMuted:realStream?.getAudioTracks()[0]?.muted,captureEnabled:realStream?.getAudioTracks()[0]?.enabled});await sleep(100);}result.sessionPhases.push({phase,point:'end',at:performance.now(),native:await window.Capacitor.Plugins.HarmonyAudioSession.getRoute()});};
     window.addEventListener('DOMContentLoaded',()=>{
      navigator.mediaDevices.getUserMedia=async constraints=>{realStream=await realGUM(constraints);result.realCapture=realStream.getAudioTracks().some(t=>t.readyState==='live');const c=Tone.getContext().rawContext,d=c.createMediaStreamDestination(),mix=c.createGain();mix.gain.value=.04;mix.connect(d);for(const [multiple,weight] of [[1,1],[2,.5],[3,.25]]){const o=c.createOscillator(),g=c.createGain();o.frequency.value=220*multiple;g.gain.value=weight;o.connect(g).connect(mix);o.start();oscillators.push(o);}return d.stream;};
      setTimeout(async()=>{try{const h=window.harmonySinger;h.setSpeakerMode(true);document.getElementById('startBtn').click();for(let i=0;i<150;i++){if(h.lastError)throw h.lastError;if(h.isRunning&&!h.starting&&!h.calibrating&&window.harmonyNativeRoute?.active)break;await sleep(100);}if(!h.isRunning||h.starting||h.calibrating||!window.harmonyNativeRoute?.active)throw new Error('engine/native activation readiness timeout');result.initialExtraProtection=h.extraProtection;await sample('normal',2000);h.setDebugContinuous(true);await sample('continuous',3500);h.setExtraProtection(true);await sample('continuous-forced-protection',3500);h.setExtraProtection(false);await sample('continuous-web-default-protection',3500);const c=h.audioContext,o=c.createOscillator(),g=c.createGain(),a=c.createAnalyser();o.frequency.value=440;g.gain.value=.005;o.connect(g);g.connect(a);g.connect(c.destination);o.start();oscillators.push(o);await sample('direct-plus-harmony',1000,a);o.stop();g.disconnect();result.lastError=String(h.lastError||'');result.contextAfter={state:c.state,currentTime:c.currentTime};await finish();}catch(e){result.errors.push(String(e?.stack||e));await finish();}},1500);
     });
     setTimeout(()=>{result.errors.push('probe deadline');finish();},30000);
    })();
    """#
}
#endif

#endif
