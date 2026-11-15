"""Reject altool's exit-zero error output; require success for the exact artifact."""
import re

def require_altool_success(text,operation,artifact):
    if operation not in ('validate','upload'):raise ValueError('Unknown altool operation')
    if re.search(r'\b(?:ERROR|FAILED|FAILURE)\b',text,re.IGNORECASE):
        raise ValueError('altool reported an error despite its process exit status; inspect the task log')
    verb='validating' if operation=='validate' else 'uploading'
    expected="No errors "+verb+" archive at '"+str(artifact)+"'."
    if expected not in [line.strip() for line in text.splitlines()]:
        raise ValueError('altool did not confirm success for the exact verified artifact')
