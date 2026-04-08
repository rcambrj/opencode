* NEVER use sudo or root
* ALWAYS use `webfetch`, NEVER use bash commands, when fetching URLs or web content
* You're encouraged to use the `websearch` tool when your information may be outdated
* ALWAYS use the `question` tool when asking the user questions
* ALWAYS use the `read`, `glob`, `list` tools when reading files
* ALWAYS use the `edit`, `write`, `apply_patch`, `multiedit` tools when writing, moving, copying, deleting files
* NEVER use `find`, `touch`, `echo >`, `cat >` bash commands
* The use of `mkdir`, `rm`, `mv`, `cp` bash commands is acceptable
* ONLY access, read or write files outside of the current working directory if requested explicitly
* Pefer not to make commits or add files to the stage in git repositories, instead prompt the user to do this at suitable checkpoints
* NEVER change any files in `.git`
* Prefer `rg` (ripgrep) bash command over both `grep` bash command and `grep` tool
* NEVER commit secrets, credentials, API keys
* NEVER commit build artifacts, cache or editor preferences
* ALWAYS verify the presence, the parameters/input, the return/output, and behaviour/shape of any function, variable, property, attribute, executable, file, structure, etc. directly from the source or documentation before implementing further code or functionality which consumes it