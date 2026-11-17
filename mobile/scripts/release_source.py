"""Read only the actual task checkout, regardless of inherited Git configuration."""
import os
from pathlib import Path
import subprocess

def child_env():
    env={key:value for key,value in os.environ.items() if not key.startswith('GIT_')}
    env.update(GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_OPTIONAL_LOCKS='0')
    return env

def git(root,*arguments):
    return subprocess.check_output(['/usr/bin/git','-c','core.fsmonitor=false','-C',str(Path(root).resolve()),*arguments],env=child_env(),text=True,stderr=subprocess.DEVNULL).strip()

def checked_source(root,source):
    root=Path(root).resolve()
    if Path(git(root,'rev-parse','--show-toplevel')).resolve()!=root:
        raise ValueError('Source is not its own Git worktree root')
    if git(root,'rev-parse','HEAD')!=source or git(root,'status','--porcelain','--untracked-files=normal'):
        raise ValueError('Exact clean reviewed source required')
    return git(root,'log','-1','--format=%cI',source)
