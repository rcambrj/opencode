* NEVER use sudo or root
* ALWAYS use `webfetch`, NEVER use bash commands, when fetching URLs or web content
* You're encouraged to use the `websearch` tool when your information may be outdated
* ALWAYS use the `question` tool when asking the user questions
* ALWAYS use the `read`, `glob`, `list` tools when reading files
* ALWAYS use the `edit`, `write`, `apply_patch`, `multiedit` tools when writing, moving, copying, deleting files
* NEVER use `find`, `touch`, `echo >`, `cat >` bash commands
* The use of `mkdir`, `rm`, `mv`, `cp` bash commands is acceptable
* ONLY access, read or write files outside of the current working directory if requested explicitly
* ALWAYS seek approval to commit changes to git, showing the commit message and the diff
* ALWAYS seek approval to push changes to git, showing the commit log
* NEVER git push --force or --force-with-lease
* NEVER git push to the `main` branch
* NEVER change any files in `.git`
* Prefer `rg` (ripgrep) bash command over both `grep` bash command and `grep` tool
* NEVER commit secrets, credentials, API keys
* NEVER commit build artifacts, cache or editor preferences
* ALWAYS verify the presence, the parameters/input, the return/output, and behaviour/shape of any function, variable, property, attribute, executable, file, structure, etc. directly from the source or documentation before implementing further code or functionality which consumes it
* ALWAYS use `jq` to parse JSON, never use python, node, perl or other scripting
* ALWAYS use `--prune` when running `git fetch`
* ALWAYS regenerate the lockfile after changing the dependencies declaration, eg. run `pnpm install` after changing `package.json`