# Default profiles

Each YAML profile and its system-prompt Markdown file live together in this
directory. Relative `system_prompt` paths resolve from the YAML file, not from
the directory where Harness starts.

The release installer copies this directory to `~/.harness/profiles/` on first
install. Existing local profiles are never overwritten.
