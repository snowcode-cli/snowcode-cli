# Profile initialization for Google Vertex AI
# Usage: bun run profile:vertex
# Or: bun run profile:init -- --provider vertex --model gemini-2.5-flash-lite --api-key YOUR_API_KEY

set -e

# Default configuration
VERTEX_BASE_URL=${OPENAI_BASE_URL:-https://aiplatform.googleapis.com/v1}
VERTEX_MODEL=${OPENAI_MODEL:-gemini-2.5-flash-lite}

echo "🚀 Setting up Google Vertex AI profile..."
echo ""
echo "Configuration:"
echo "  Base URL: $VERTEX_BASE_URL"
echo "  Model: $VERTEX_MODEL"
echo ""

# Check if API key is provided
if [ -z "$OPENAI_API_KEY" ]; then
  echo "⚠️  OPENAI_API_KEY not set!"
  echo "   Set it with: export OPENAI_API_KEY=your-vertex-api-key"
  echo "   Or run: bun run profile:init -- --provider vertex --api-key YOUR_API_KEY"
  echo ""
  exit 1
fi

echo "✅ Vertex AI profile configured"
echo ""
echo "To start Claude Code with Vertex AI:"
echo "  bun run dev:vertex"
echo ""
echo "Or manually:"
echo "  export CLAUDE_CODE_USE_OPENAI=1"
echo "  export OPENAI_BASE_URL=$VERTEX_BASE_URL"
echo "  export OPENAI_MODEL=$VERTEX_MODEL"
echo "  bun run dev"
