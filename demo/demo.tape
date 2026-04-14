Output demo.gif
Output demo.mp4

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"

# Start flt TUI in a fresh tmux
Type "tmux new-session -d -s demo && flt tui"
Enter
Sleep 3s

# Navigate agents
Type "j"
Sleep 400ms
Type "j"
Sleep 400ms
Type "k"
Sleep 800ms

# Focus log
Enter
Sleep 1.5s

# Scroll
Type "jjjj"
Sleep 500ms
Type "G"
Sleep 1s

# Insert mode
Type "i"
Sleep 500ms
Type@50ms "what's your current status?"
Enter
Sleep 2s
Escape
Sleep 500ms
Escape
Sleep 800ms

# Spawn an agent
Type ":"
Sleep 300ms
Type@40ms "spawn demo --cli codex --model gpt-5.3-codex \"run tests\""
Enter
Sleep 3s

# Theme switching
Type ":"
Sleep 200ms
Type@40ms "theme dracula"
Enter
Sleep 2s

Type ":"
Sleep 200ms
Type@40ms "theme catppuccin"
Enter
Sleep 2s

# Inbox
Type "m"
Sleep 2s
Type "j"
Sleep 400ms
Type "k"
Sleep 400ms
Escape
Sleep 1s

# Kill demo agent
Type ":"
Sleep 200ms
Type@40ms "kill demo"
Enter
Sleep 500ms
Type "y"
Sleep 2s
