import unittest
from pathlib import Path
from altool_output import require_altool_success
A=Path('/tmp/Harmony (1).ipa')
class AltoolGuard(unittest.TestCase):
 def test_positive_exact_artifact(self):
  for operation,verb in [('validate','validating'),('upload','uploading')]:
   for warning in ['',', 1 warnings,',', 2 warnings,',', 1 warning,']:
    with self.subTest(operation=operation,warning=warning):require_altool_success("No errors"+warning+" "+verb+" archive at '"+str(A)+"'.",operation,A)
 def test_reject_bad_or_ambiguous_output(self):
  good="No errors, 1 warnings, validating archive at '"+str(A)+"'."
  for bad in [good+'\nERROR: failed',good+'\nFAILED',good+'\nFAILURE',good.replace(str(A),'/tmp/other.ipa'),good.replace('validating','uploading'),good.replace('1 warnings','-1 warnings'),good.replace('1 warnings','many warnings'),'VERIFY SUCCEEDED with no errors, 1 warning',good+' trailing text']:
   with self.subTest(bad=bad):
    with self.assertRaises(ValueError):require_altool_success(bad,'validate',A)
 def test_missing_asc_record_zero_exit(self):
  with self.assertRaises(ValueError):require_altool_success('ERROR: Cannot determine the Apple ID from Bundle ID','validate',A)
if __name__=='__main__':unittest.main()
