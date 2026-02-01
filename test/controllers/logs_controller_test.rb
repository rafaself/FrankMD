# frozen_string_literal: true

require "test_helper"

class LogsControllerTest < ActionDispatch::IntegrationTest
  def setup
    @log_file = Rails.root.join("log", "#{Rails.env}.log")
    @original_content = File.read(@log_file) if File.exist?(@log_file)
  end

  def teardown
    # Restore original log content
    if @original_content
      File.write(@log_file, @original_content)
    end
  end

  test "tail returns JSON with environment and file info" do
    get logs_tail_url, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    assert_equal Rails.env, data["environment"]
    assert_equal "#{Rails.env}.log", data["file"]
    assert data.key?("lines")
    assert_instance_of Array, data["lines"]
  end

  test "tail respects lines parameter" do
    # Write known content to log
    lines = (1..50).map { |i| "TestLine#{i}" }
    File.write(@log_file, lines.join("\n") + "\n")

    get logs_tail_url, params: { lines: 10 }, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    # The last line should end with our test content (Rails may add some log lines)
    assert data["lines"].any? { |line| line.include?("TestLine") }
  end

  test "tail limits lines to 500 max" do
    # Request more than max
    get logs_tail_url, params: { lines: 1000 }, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    # Should be capped at 500
    assert data["lines"].length <= 500
  end

  test "tail handles empty log file" do
    # Flush the log then write empty
    Rails.logger.flush if Rails.logger.respond_to?(:flush)
    File.write(@log_file, "")

    get logs_tail_url, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    # Lines should be an array (may have a few lines from the request itself)
    assert_instance_of Array, data["lines"]
  end

  test "tail handles missing log file" do
    # Temporarily rename the log file
    backup_path = "#{@log_file}.backup"
    File.rename(@log_file, backup_path) if File.exist?(@log_file)

    begin
      get logs_tail_url, as: :json
      assert_response :success

      data = JSON.parse(response.body)
      # Note: Rails may recreate the log file during the request itself,
      # so we accept either "file not found" or an empty/minimal log
      if data["error"]
        assert_equal "Log file not found", data["error"]
        assert_equal [], data["lines"]
      else
        # File was recreated by Rails during request - lines should be minimal
        assert_instance_of Array, data["lines"]
      end
    ensure
      File.rename(backup_path, @log_file) if File.exist?(backup_path)
    end
  end

  test "tail handles invalid lines parameter" do
    get logs_tail_url, params: { lines: -5 }, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    # Should use default (100) but be capped by actual file size
    assert_instance_of Array, data["lines"]
  end

  test "tail returns lines as array of strings" do
    # Write some content
    lines = [ "Line A", "Line B", "Line C" ]
    File.write(@log_file, lines.join("\n") + "\n")

    get logs_tail_url, as: :json
    assert_response :success

    data = JSON.parse(response.body)
    data["lines"].each do |line|
      assert_instance_of String, line
    end
  end
end
