# frozen_string_literal: true

class LogsController < ApplicationController
  # GET /logs/tail
  # Returns the last N lines of the current environment's log
  def tail
    lines = params[:lines].to_i
    lines = 100 if lines <= 0 || lines > 500

    log_file = Rails.root.join("log", "#{Rails.env}.log")

    unless File.exist?(log_file)
      render json: { error: "Log file not found", lines: [] }
      return
    end

    # Read last N lines efficiently
    content = tail_file(log_file, lines)

    render json: {
      environment: Rails.env,
      file: log_file.basename.to_s,
      lines: content
    }
  end

  private

  def tail_file(path, num_lines)
    lines = []
    File.open(path, "rb") do |file|
      # Start from end of file
      file.seek(0, IO::SEEK_END)
      size = file.pos
      return [] if size == 0

      buffer = ""
      chunk_size = 8192
      pos = size

      while lines.size < num_lines && pos > 0
        read_size = [chunk_size, pos].min
        pos -= read_size
        file.seek(pos)
        buffer = file.read(read_size) + buffer

        # Split into lines and keep counting
        all_lines = buffer.split("\n", -1)
        if pos > 0
          # Keep incomplete first line in buffer
          buffer = all_lines.shift || ""
        end
        lines = all_lines + lines
      end
    end

    lines.last(num_lines)
  end
end
