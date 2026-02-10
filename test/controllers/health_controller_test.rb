# frozen_string_literal: true

require "test_helper"

class HealthControllerTest < ActionDispatch::IntegrationTest
  test "health check returns OK" do
    get rails_health_check_url
    assert_response :success
    assert_equal "OK", response.body
  end

  test "health check sets CORS header" do
    get rails_health_check_url
    assert_equal "*", response.headers["Access-Control-Allow-Origin"]
  end
end
