* NEVER use sudo or root
* ALWAYS use `webfetch`, NEVER use bash commands, when fetching URLs or web content
* You're encouraged to use the `websearch` tool when your information may be outdated
* NEVER use the `question` tool, instead ask questions in the textual response
* ALWAYS use the `read`, `glob` tools when reading files
* ALWAYS use the `edit`, `write`, `apply_patch`, `multiedit` tools when writing, moving, copying, deleting files
* ALWAYS use `apply_patch` for existing files instead of `write`
* NEVER use `find`, `touch`, `echo >`, `cat >` bash commands
* The use of `mkdir`, `rm`, `mv`, `cp` bash commands is acceptable
* ONLY access, read or write files outside of the current working directory if requested explicitly
* ALWAYS seek approval to commit changes to git, showing the commit message and the diff
* ALWAYS seek approval to push changes to git, showing the commit log
* NEVER git push --force or --force-with-lease
* NEVER git push to the `main` branch
* NEVER change any files in `.git`
* NEVER use the `grep` tool
* NEVER commit secrets, credentials, API keys
* NEVER commit build artifacts, cache or editor preferences
* ALWAYS verify the presence, the parameters/input, the return/output, and behaviour/shape of any function, variable, property, attribute, executable, file, structure, etc. directly from the source or documentation before implementing further code or functionality which consumes it
* ALWAYS use `jq` to parse JSON, never use python, node, perl or other scripting
* ALWAYS use `--prune` when running `git fetch`
* ALWAYS regenerate the lockfile after changing the dependencies declaration, eg. run `pnpm install` after changing `package.json`
* NEVER run `cd` unnecessarily to the current working directory
* ALWAYS convert github.com links to raw.githubusercontent.com
* ALWAYS stage newly created files in git if they will be loaded by `nix`, `nix` will not load files which are not tracked by git. 
* NEVER put parameters between `kubectl` and `get`; bad: `kubectl -n foo get`; good: `kubectl get -n foo`

## Searching files and github repositories
* DISREGARD OpenCode's "When searching for text or files, prefer using Glob and Grep tools"
* ALWAYS use `semble` first. Usage: `semble search "authentication flow" ./my-project`. `--content` accepts `code` (default), `docs`, `config`, or `all`. `path` defaults to the current directory when omitted; git URLs are accepted.
* ONLY use `rg` / `glob` when you need exhaustive literal matches or confirmation of an exact string
* In doubt, use `semble` first, then `rg` / `glob` to further narrow the search
