// Initialize offline fixtures synchronously. Offline rendering can advance one second
// before delivering MessagePort commands; production stays muted until a real command.
import {ResonanceProcessor} from '../worklet.mjs';
class OfflineFixture extends ResonanceProcessor {
 constructor(options){super(options);this.mode=options.processorOptions.testMode;}
}
registerProcessor('resonance-offline-test',OfflineFixture);
