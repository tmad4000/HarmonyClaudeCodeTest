import AVFoundation
import Capacitor
import UIKit
import WebKit

@objc(HarmonyViewController)
class HarmonyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HarmonyAudioSession())
    }
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--harmony-smoke") {
            config.userContentController.add(self, name: "harmonySmoke")
            config.userContentController.addUserScript(WKUserScript(source: Self.smokeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
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
        try session.setActive(true)
        active = true
        UIApplication.shared.isIdleTimerDisabled = true
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
                "categoryOptions": Int(s.categoryOptions.rawValue), "active": active]
    }
    private func configureCall(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do { try self.configure(); call.resolve(self.route()) }
            catch { self.deactivate(); call.reject("Audio session could not start: \(error.localizedDescription)") }
        }
    }
    @objc func prepare(_ call: CAPPluginCall) { configureCall(call) }
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
      const result={test:'native-default-recording-notice',syntheticMic:true,realUploads:0,requests:[],paintedFrames:0,errors:[]};
      let firstPaint=null,done=false;
      const realFetch=window.fetch.bind(window);
      const visible=()=>{const n=document.getElementById('firstDebugNotice');if(!n)return false;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return !n.hidden&&r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&n.textContent.includes('Ideaflow');};
      const paint=()=>{if(visible()){result.paintedFrames++;firstPaint??=performance.now();}if(!done)requestAnimationFrame(paint);};requestAnimationFrame(paint);
      window.fetch=async(input,options)=>{const url=typeof input==='string'?input:input.url;if(url.includes('globalbr.ai/api/ingest/harmony/v1')){result.requests.push({path:new URL(url).pathname,method:options?.method||'GET',at:performance.now(),noticeVisible:visible(),paintedFrames:result.paintedFrames});return new Response(JSON.stringify({error:'synthetic_smoke_no_network'}),{status:503,headers:{'Content-Type':'application/json'}});}return realFetch(input,options);};
      window.addEventListener('error',e=>result.errors.push(e.message));
      const report=()=>{if(done)return;done=true;window.harmonySinger?.stop();result.firstPaint=firstPaint;result.defaultRecordingOn=window.harmonyDebug?.enabled===true;result.nativeRoute=window.harmonyNativeRoute;result.running=window.harmonySinger?.isRunning;result.lastError=window.harmonySinger?.lastError;result.pass=result.defaultRecordingOn&&result.requests.length>0&&result.requests.every(r=>r.noticeVisible&&r.paintedFrames>1&&r.at>firstPaint);window.webkit.messageHandlers.harmonySmoke.postMessage(result);};
      window.addEventListener('DOMContentLoaded',()=>setTimeout(async()=>{try{
        result.beforeSingRequests=result.requests.length;
        navigator.mediaDevices.getUserMedia=async()=>{const c=Tone.getContext().rawContext,o=c.createOscillator(),g=c.createGain(),d=c.createMediaStreamDestination();o.frequency.value=220;g.gain.value=.015;o.connect(g).connect(d);o.start();return d.stream;};
        document.getElementById('startBtn').click();
        setTimeout(()=>window.harmonySinger?.stop(),5000);
        setTimeout(report,10000);
      }catch(e){result.errors.push(String(e));report();}},1500));
      setTimeout(report,20000);
    })();
    """#
}
#endif
