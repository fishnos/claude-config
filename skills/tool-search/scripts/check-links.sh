#!/usr/bin/env bash
# Prints the final HTTP status of each URL, one per line, after redirects.
# Usage: bash check-links.sh URL...   or   printf '%s\n' URL... | bash check-links.sh
# Exits 1 when any URL fails, so a caller can tell a clean list from a dirty one.
# Some sites (figma.com) refuse scripted requests with 403; treat that as
# "exists, blocks bots", not as a dead link.

set -u

user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

if (( $# > 0 )); then
  urls=("$@")
else
  urls=()
  while IFS= read -r line; do urls+=("$line"); done
fi

failures=0
# The ${var+...} guard keeps bash 3.2 (macOS) from treating an empty array as unset under set -u.
for url in ${urls[@]+"${urls[@]}"}; do
  [[ -z "$url" ]] && continue
  status=$(curl --silent --location --output /dev/null --max-time 15 \
    --user-agent "$user_agent" --write-out '%{http_code}' "$url")
  case "$status" in
    2??) verdict=ok ;;
    403) verdict=blocked ;;
    *) verdict=dead; failures=$((failures + 1)) ;;
  esac
  printf '%s\t%s\t%s\n' "$status" "$verdict" "$url"
done

(( failures == 0 ))
