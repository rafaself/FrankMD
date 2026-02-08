# FrankMD shell functions
# Source this file in your ~/.bashrc or ~/.zshrc:
#   source ~/.config/frankmd/fed.sh

# Default browser (override with FRANKMD_BROWSER)
: "${FRANKMD_BROWSER:=brave}"

# Open FrankMD with a notes directory
fed() {
  local notes="$(realpath "${1:-.}")"
  local splash="$HOME/.config/frankmd/splash.html"

  # Ensure container is running with correct notes path
  if docker ps -q -f name=frankmd 2>/dev/null | grep -q .; then
    local current
    current=$(docker inspect frankmd --format '{{range .Mounts}}{{if eq .Destination "/rails/notes"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
    [[ "$current" != "$notes" ]] && docker stop frankmd >/dev/null 2>&1
  fi

  # Start container if not running
  if ! docker ps -q -f name=frankmd 2>/dev/null | grep -q .; then
    docker rm frankmd 2>/dev/null

    # Forward host env vars if set (Config .fed file still overrides these)
    local env_flags=()
    local env_vars=(
      IMAGES_PATH
      AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET AWS_REGION
      YOUTUBE_API_KEY
      GOOGLE_API_KEY GOOGLE_CSE_ID
      AI_PROVIDER AI_MODEL
      OLLAMA_API_BASE OLLAMA_MODEL
      OPENROUTER_API_KEY OPENROUTER_MODEL
      ANTHROPIC_API_KEY ANTHROPIC_MODEL
      GEMINI_API_KEY GEMINI_MODEL
      OPENAI_API_KEY OPENAI_MODEL
      IMAGE_GENERATION_MODEL
      FRANKMD_LOCALE
    )
    for var in "${env_vars[@]}"; do
      local val
      eval "val=\"\${$var:-}\""
      [[ -n "$val" ]] && env_flags+=(-e "$var=$val")
    done

    docker run -d --name frankmd --rm \
      -p 7591:80 \
      --user "$(id -u):$(id -g)" \
      -v "$notes:/rails/notes" \
      "${env_flags[@]}" \
      ${FRANKMD_ENV:+--env-file "$FRANKMD_ENV"} \
      akitaonrails/frankmd:latest >/dev/null
  fi

  # Open browser with splash (polls until Rails is ready)
  "$FRANKMD_BROWSER" --app="file://$splash"
}

# Update FrankMD Docker image
fed-update() {
  echo "Checking for updates..."
  local old_digest new_digest
  old_digest=$(docker images --digests --format "{{.Digest}}" akitaonrails/frankmd:latest 2>/dev/null | head -1)
  docker pull akitaonrails/frankmd:latest
  new_digest=$(docker images --digests --format "{{.Digest}}" akitaonrails/frankmd:latest 2>/dev/null | head -1)

  if [[ "$old_digest" != "$new_digest" ]]; then
    echo "Updated! Restart FrankMD to use new version."
    docker stop frankmd 2>/dev/null
  else
    echo "Already up to date."
  fi
}

# Stop FrankMD
fed-stop() {
  docker stop frankmd 2>/dev/null && echo "Stopped." || echo "Not running."
}
