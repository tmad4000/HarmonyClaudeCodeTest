"""Reject altool's exit-zero error output; require success for the exact artifact."""
import re

def require_altool_success(text,operation,artifact):
    if operation not in ('validate','upload'):raise ValueError('Unknown altool operation')
    if re.search(r'\b(?:ERROR|FAILED|FAILURE)\b',text,re.IGNORECASE):
        raise ValueError('altool reported an error despite its process exit status; inspect the task log')
    verb='validating' if operation=='validate' else 'uploading'
    # Apple includes a warning count in the same exact-artifact success line.
    expected = r"No errors(?:, [1-9][0-9]* warnings?,)? " + verb + r" archive at '" + re.escape(str(artifact)) + r"'\."
    if not any(re.fullmatch(expected,line.strip()) for line in text.splitlines()):
        raise ValueError('altool did not confirm success for the exact verified artifact')
