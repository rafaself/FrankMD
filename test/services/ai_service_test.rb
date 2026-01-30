# frozen_string_literal: true

require "test_helper"

class AiServiceTest < ActiveSupport::TestCase
  def setup
    setup_test_notes_dir
    # Save and clear all AI-related env vars
    @original_env = {}
    %w[
      OPENAI_API_KEY OPENROUTER_API_KEY ANTHROPIC_API_KEY
      GEMINI_API_KEY OLLAMA_API_BASE AI_PROVIDER AI_MODEL
      OPENAI_MODEL OPENROUTER_MODEL ANTHROPIC_MODEL GEMINI_MODEL OLLAMA_MODEL
    ].each do |key|
      @original_env[key] = ENV[key]
      ENV.delete(key)
    end
  end

  def teardown
    teardown_test_notes_dir
    # Restore original env vars
    @original_env.each do |key, value|
      if value
        ENV[key] = value
      else
        ENV.delete(key)
      end
    end
  end

  # Provider detection tests
  test "enabled? returns false when no providers configured" do
    assert_not AiService.enabled?
  end

  test "enabled? returns true when OpenAI key is set" do
    ENV["OPENAI_API_KEY"] = "sk-test-key"
    assert AiService.enabled?
  end

  test "enabled? returns true when OpenRouter key is set" do
    ENV["OPENROUTER_API_KEY"] = "sk-or-test-key"
    assert AiService.enabled?
  end

  test "enabled? returns true when Anthropic key is set" do
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test-key"
    assert AiService.enabled?
  end

  test "enabled? returns true when Gemini key is set" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    assert AiService.enabled?
  end

  test "enabled? returns true when Ollama base is set" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    assert AiService.enabled?
  end

  # Provider priority tests (auto mode)
  # Priority: openai > anthropic > openrouter > ollama > gemini
  # Gemini is lowest because its key is primarily for image generation (Imagen)
  test "current_provider returns openai when multiple providers available" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["OPENAI_API_KEY"] = "sk-test"
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"

    assert_equal "openai", AiService.current_provider
  end

  test "current_provider returns anthropic when openai not available" do
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"
    ENV["GEMINI_API_KEY"] = "gemini-test"

    assert_equal "anthropic", AiService.current_provider
  end

  test "current_provider returns openrouter when higher priority not available" do
    ENV["OPENROUTER_API_KEY"] = "sk-or-test"
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["GEMINI_API_KEY"] = "gemini-test"

    assert_equal "openrouter", AiService.current_provider
  end

  test "current_provider returns ollama over gemini" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["GEMINI_API_KEY"] = "gemini-test"

    assert_equal "ollama", AiService.current_provider
  end

  test "current_provider returns gemini when only gemini available" do
    ENV["GEMINI_API_KEY"] = "gemini-test"

    assert_equal "gemini", AiService.current_provider
  end

  # Provider override tests
  test "current_provider respects ai_provider override" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["OPENAI_API_KEY"] = "sk-test"
    ENV["AI_PROVIDER"] = "openai"

    assert_equal "openai", AiService.current_provider
  end

  test "current_provider falls back to priority when override not available" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["AI_PROVIDER"] = "openai"  # OpenAI not configured

    assert_equal "ollama", AiService.current_provider
  end

  # Model selection tests
  test "current_model returns provider-specific default" do
    ENV["OPENAI_API_KEY"] = "sk-test"
    assert_equal "gpt-4o-mini", AiService.current_model
  end

  test "current_model returns ollama default model" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    assert_equal "llama3.2:latest", AiService.current_model
  end

  test "current_model returns anthropic default model" do
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"
    assert_equal "claude-sonnet-4-20250514", AiService.current_model
  end

  test "current_model returns gemini default model" do
    ENV["GEMINI_API_KEY"] = "gemini-test"
    assert_equal "gemini-2.0-flash", AiService.current_model
  end

  test "current_model returns openrouter default model" do
    ENV["OPENROUTER_API_KEY"] = "sk-or-test"
    assert_equal "openai/gpt-4o-mini", AiService.current_model
  end

  test "current_model respects ai_model global override" do
    ENV["OPENAI_API_KEY"] = "sk-test"
    ENV["AI_MODEL"] = "gpt-4-turbo"

    assert_equal "gpt-4-turbo", AiService.current_model
  end

  test "current_model respects provider-specific model override" do
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"
    ENV["ANTHROPIC_MODEL"] = "claude-3-opus-20240229"

    assert_equal "claude-3-opus-20240229", AiService.current_model
  end

  # Error handling tests
  test "fix_grammar returns error when not configured" do
    result = AiService.fix_grammar("Hello world")
    assert_equal "AI not configured", result[:error]
  end

  test "fix_grammar returns error when text is blank" do
    ENV["OPENAI_API_KEY"] = "sk-test-key"
    result = AiService.fix_grammar("")
    assert_equal "No text provided", result[:error]
  end

  test "fix_grammar returns error when text is nil" do
    ENV["OPENAI_API_KEY"] = "sk-test-key"
    result = AiService.fix_grammar(nil)
    assert_equal "No text provided", result[:error]
  end

  # Provider info tests
  test "provider_info returns correct structure" do
    ENV["OPENAI_API_KEY"] = "sk-test"
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"

    info = AiService.provider_info

    assert_includes info.keys, :enabled
    assert_includes info.keys, :provider
    assert_includes info.keys, :model
    assert_includes info.keys, :available_providers

    assert info[:enabled]
    assert_equal "openai", info[:provider]  # openai has highest priority
    assert_includes info[:available_providers], "openai"
    assert_includes info[:available_providers], "anthropic"
  end

  test "available_providers returns all configured providers" do
    ENV["OLLAMA_API_BASE"] = "http://localhost:11434"
    ENV["OPENAI_API_KEY"] = "sk-test"
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"

    providers = AiService.available_providers

    assert_includes providers, "ollama"
    assert_includes providers, "openai"
    assert_includes providers, "anthropic"
    assert_not_includes providers, "gemini"
    assert_not_includes providers, "openrouter"
  end

  # Image generation tests
  test "image_generation_enabled? returns false when no Gemini key" do
    assert_not AiService.image_generation_enabled?
  end

  test "image_generation_enabled? returns true when Gemini key is set" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    assert AiService.image_generation_enabled?
  end

  test "image_generation_model returns default model" do
    assert_equal "imagen-4.0-generate-001", AiService.image_generation_model
  end

  test "image_generation_info returns correct structure" do
    info = AiService.image_generation_info
    assert_includes info.keys, :enabled
    assert_includes info.keys, :model
    assert_equal false, info[:enabled]
    assert_equal "imagen-4.0-generate-001", info[:model]
  end

  test "image_generation_info returns enabled when Gemini key set" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    info = AiService.image_generation_info
    assert_equal true, info[:enabled]
  end

  test "generate_image returns error when not configured" do
    result = AiService.generate_image("A sunset over mountains")
    assert_includes result[:error], "not configured"
  end

  test "generate_image returns error when prompt is blank" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    result = AiService.generate_image("")
    assert_equal "No prompt provided", result[:error]
  end

  test "generate_image returns error when prompt is nil" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    result = AiService.generate_image(nil)
    assert_equal "No prompt provided", result[:error]
  end

  test "generate_image accepts reference_image_path parameter" do
    ENV["GEMINI_API_KEY"] = "gemini-test-key"
    # This will fail at the API call since we don't have a real key,
    # but it verifies the method accepts the parameter
    result = AiService.generate_image("A sunset", reference_image_path: "nonexistent.jpg")
    # Should not error on the parameter itself - will fail later at API call
    # Reference image doesn't exist, so it falls back to text-only which hits Imagen API
    assert result[:error].present?
  end

  # === fix_grammar success path (mocked) ===

  test "fix_grammar returns corrected text on success" do
    ENV["OPENAI_API_KEY"] = "sk-test-key"

    # Create mock response and chat objects using mocha
    mock_response = stub(content: "This is corrected text.")
    mock_chat = stub
    mock_chat.stubs(:with_instructions).returns(mock_chat)
    mock_chat.stubs(:ask).returns(mock_response)

    RubyLLM.stubs(:chat).returns(mock_chat)

    result = AiService.fix_grammar("This is uncorrected text")

    assert_equal "This is corrected text.", result[:corrected]
    assert_equal "openai", result[:provider]
    assert_equal "gpt-4o-mini", result[:model]
  end

  test "fix_grammar returns error on API failure" do
    ENV["OPENAI_API_KEY"] = "sk-test-key"

    mock_chat = stub
    mock_chat.stubs(:with_instructions).returns(mock_chat)
    mock_chat.stubs(:ask).raises(StandardError.new("API connection failed"))

    RubyLLM.stubs(:chat).returns(mock_chat)

    result = AiService.fix_grammar("Some text")

    assert result[:error].present?
    assert_includes result[:error], "API connection failed"
  end

  test "fix_grammar works with anthropic provider" do
    ENV["ANTHROPIC_API_KEY"] = "sk-ant-test"

    mock_response = stub(content: "Fixed by Claude")
    mock_chat = stub
    mock_chat.stubs(:with_instructions).returns(mock_chat)
    mock_chat.stubs(:ask).returns(mock_response)

    RubyLLM.stubs(:chat).returns(mock_chat)

    result = AiService.fix_grammar("Input text")

    assert_equal "Fixed by Claude", result[:corrected]
    assert_equal "anthropic", result[:provider]
  end

  # === Image generation response parsing ===

  test "extract_image_from_imagen_response extracts base64 data" do
    response = {
      "predictions" => [
        {
          "bytesBase64Encoded" => "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "mimeType" => "image/png"
        }
      ]
    }

    result = AiService.extract_image_from_imagen_response(response, "imagen-4.0-generate-001")

    assert result[:data].present?
    assert_equal "image/png", result[:mime_type]
    assert_equal "imagen-4.0-generate-001", result[:model]
    assert_nil result[:error]
  end

  test "extract_image_from_imagen_response handles empty predictions" do
    response = { "predictions" => [] }

    result = AiService.extract_image_from_imagen_response(response, "model")

    assert_equal "No predictions in response", result[:error]
  end

  test "extract_image_from_imagen_response handles missing image data" do
    response = {
      "predictions" => [
        { "text" => "Some text response" }
      ]
    }

    result = AiService.extract_image_from_imagen_response(response, "model")

    assert_equal "No image data in response", result[:error]
  end

  test "extract_image_from_gemini_response extracts inline image" do
    response = {
      "candidates" => [
        {
          "content" => {
            "parts" => [
              {
                "inlineData" => {
                  "data" => "base64imagedata==",
                  "mimeType" => "image/jpeg"
                }
              }
            ]
          }
        }
      ]
    }

    result = AiService.extract_image_from_gemini_response(response, "gemini-model")

    assert_equal "base64imagedata==", result[:data]
    assert_equal "image/jpeg", result[:mime_type]
    assert_equal "gemini-model", result[:model]
  end

  test "extract_image_from_gemini_response handles empty candidates" do
    response = { "candidates" => [] }

    result = AiService.extract_image_from_gemini_response(response, "model")

    assert_equal "No candidates in response", result[:error]
  end

  test "extract_image_from_gemini_response handles nil response" do
    result = AiService.extract_image_from_gemini_response(nil, "model")

    assert_equal "No response from Gemini", result[:error]
  end

  # === mime_type_for_path ===

  test "mime_type_for_path returns correct types" do
    assert_equal "image/jpeg", AiService.mime_type_for_path("/path/to/image.jpg")
    assert_equal "image/jpeg", AiService.mime_type_for_path("/path/to/image.jpeg")
    assert_equal "image/png", AiService.mime_type_for_path("/path/to/image.png")
    assert_equal "image/gif", AiService.mime_type_for_path("/path/to/image.gif")
    assert_equal "image/webp", AiService.mime_type_for_path("/path/to/image.webp")
    assert_equal "image/jpeg", AiService.mime_type_for_path("/path/to/file.unknown")
  end
end
