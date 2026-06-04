#!/bin/bash
# Claude Code statusline — mellow blue gradient with powerline arrows
#
# Each segment has its own blue-shade bg, separated by  arrows.
# Text gradient sweeps L→R across ALL segments continuously.
# Requires: jq, git, Nerd Font (powerline glyphs   )

input=$(cat)

# ── Inputs ───────────────────────────────────────────────────────────────────
dir_real=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[ -z "$dir_real" ] && dir_real=$(pwd)
dir=$(echo "$dir_real" | sed "s|^$HOME|~|")

model=$(echo "$input" | jq -r '.model.display_name // empty')
used=$(echo "$input"  | jq -r '.context_window.used_percentage // empty')
branch=$(git -C "$dir_real" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null)

PHASE=$(( $(date +%s) % 60 ))     # gentle drift

# ── ANSI ─────────────────────────────────────────────────────────────────────
ESC=$'\033'
RESET="${ESC}[0m"
BOLD="${ESC}[1m"

fg() { printf '%s[38;2;%d;%d;%dm' "$ESC" "$1" "$2" "$3"; }
bg() { printf '%s[48;2;%d;%d;%dm' "$ESC" "$1" "$2" "$3"; }

# Powerline glyphs (UTF-8 bytes — written this way so they survive editor saves)
PL_ARROW=$'\xee\x82\xb0'   # U+E0B0  right wedge
PL_LARROW=$'\xee\x82\xb2'  # U+E0B2  left wedge
PL_CAP_L=$'\xee\x82\xb6'   # U+E0B6  rounded left
PL_CAP_R=$'\xee\x82\xb4'   # U+E0B4  rounded right

# Nerd Font icons
ICO_APPLE=$'\xef\x85\xb9'  # U+F179  Apple
ICO_FOLDER=$'\xef\x81\xbb' # U+F07B  folder (closed)
ICO_BRANCH=$'\xee\x9c\xa5' # U+E725  devicons git-branch
ICO_GAUGE=$'\xef\x98\xa4'  # U+F624  gauge

clamp() { local v=$1; ((v<0))&&v=0; ((v>255))&&v=255; echo "$v"; }

# ── Mellow blue palette ──────────────────────────────────────────────────────
# Text gradient (foreground): periwinkle → soft sky
TG1_R=120; TG1_G=145; TG1_B=195
TG2_R=190; TG2_G=215; TG2_B=240

# Segment bg stops — dark blue, gradually lightening L→R
BG1_R=18;  BG1_G=24;  BG1_B=42
BG2_R=26;  BG2_G=34;  BG2_B=58
BG3_R=34;  BG3_G=44;  BG3_B=74
BG4_R=42;  BG4_G=54;  BG4_B=88
BG5_R=50;  BG5_G=64;  BG5_B=100

# Approximate terminal background — used for the left-side notch cutout.
# Adjust if your terminal has a different bg (e.g. pure black 0/0/0).
TERM_BG_R=11; TERM_BG_G=12; TERM_BG_B=18

# ── Build segments as plain text first ───────────────────────────────────────
# (we'll color them in a second pass so the gradient is continuous)

s_user=" ⌘  $(whoami)@$(hostname -s) "

dir_parent=$(dirname "$dir")
dir_leaf=$(basename "$dir")
if [ "$dir" = "~" ] || [ "$dir_parent" = "." ] || [ "$dir_parent" = "~" ] || [ "$dir_parent" = "/" ]; then
  display_dir="$dir"
else
  dir_parent2=$(dirname "$dir_parent")
  dir_mid=$(basename "$dir_parent")
  if [ "$dir_parent2" = "." ] || [ "$dir_parent2" = "/" ] || [ "$dir_parent2" = "~" ] || [ "$dir_parent2" = "$HOME" ]; then
    display_dir="${dir_mid}/${dir_leaf}"
  else
    display_dir="…/${dir_mid}/${dir_leaf}"
  fi
fi
s_path=" ▸ $display_dir "

s_branch=""
[ -n "$branch" ] && s_branch=" ⑂ $branch "

s_model=""
if [ -n "$model" ]; then
  short_model=$(echo "$model" | sed 's/^Claude //')
  s_model=" ✦ $short_model "
fi

s_ctx=""
if [ -n "$used" ]; then
  used_int=$(printf '%.0f' "$used")
  filled=$(( used_int * 10 / 100 ))
  ((filled>10)) && filled=10
  empty=$((10 - filled))
  bar=""
  for ((i=0;i<filled;i++)); do bar+="▰"; done
  for ((i=0;i<empty; i++)); do bar+="▱"; done
  s_ctx=" ◐ $bar ${used_int}% "
fi

# ── Assemble ordered segment list (skip empty) ───────────────────────────────
# Each entry: "<text>|<bg_idx>"
declare -a SEGS
SEGS+=("${s_user}|1")
SEGS+=("${s_path}|2")
[ -n "$s_branch" ] && SEGS+=("${s_branch}|3")
[ -n "$s_model"  ] && SEGS+=("${s_model}|4")
[ -n "$s_ctx"    ] && SEGS+=("${s_ctx}|5")

# Total visible chars across all segments (for gradient ratio)
total=0
for entry in "${SEGS[@]}"; do
  text="${entry%|*}"
  total=$(( total + ${#text} ))
done
[ "$total" -le 0 ] && total=1

# Helper: get bg RGB for index
bg_rgb() {
  case "$1" in
    1) echo "$BG1_R $BG1_G $BG1_B" ;;
    2) echo "$BG2_R $BG2_G $BG2_B" ;;
    3) echo "$BG3_R $BG3_G $BG3_B" ;;
    4) echo "$BG4_R $BG4_G $BG4_B" ;;
    5) echo "$BG5_R $BG5_G $BG5_B" ;;
  esac
}

# Helper: color char at running position 0..total-1 in text gradient
char_color() {
  local pos=$1
  local t=$(( pos * 100 / total ))
  # gentle phase drift
  t=$(( (t + PHASE) % 100 ))
  ((t<0))&&t=0; ((t>100))&&t=100
  local r=$(( TG1_R + (TG2_R - TG1_R) * t / 100 ))
  local g=$(( TG1_G + (TG2_G - TG1_G) * t / 100 ))
  local b=$(( TG1_B + (TG2_B - TG1_B) * t / 100 ))
  fg "$(clamp $r)" "$(clamp $g)" "$(clamp $b)"
}

# ── Render: each segment is a standalone pill with a gap between ─────────────
out=""
running=0

for entry in "${SEGS[@]}"; do
  text="${entry%|*}"
  bg_idx="${entry##*|}"
  read -r br bgc bb <<< "$(bg_rgb "$bg_idx")"

  # Left edge: triangular notch CUT INTO the pill from the left.
  # Cell bg = segment color, glyph fg = terminal-bg color → triangle "removes"
  # a wedge from the left edge of the segment.
  out+="${RESET}$(bg $br $bgc $bb)$(fg $TERM_BG_R $TERM_BG_G $TERM_BG_B)${PL_LARROW}"

  # Segment body: set bg, color each char with continuing gradient
  out+="$(bg $br $bgc $bb)"
  len=${#text}
  i=0
  while [ $i -lt $len ]; do
    ch="${text:$i:1}"
    out+="$(char_color $running)$ch"
    running=$(( running + 1 ))
    i=$(( i + 1 ))
  done

  # Right wedge arrow on transparent bg — no extra gap (wedges create their own breathing room)
  out+="${RESET}$(fg $br $bgc $bb)${PL_ARROW}${RESET}"
done

printf '%b' "$out"
