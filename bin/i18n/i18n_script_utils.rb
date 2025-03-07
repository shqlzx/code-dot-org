require File.expand_path('../../../dashboard/config/environment', __FILE__)

require 'cdo/google/drive'
require 'cdo/honeybadger'
require 'cgi'
require 'fileutils'
require 'psych'

I18N_SOURCE_DIR = "i18n/locales/source"

CROWDIN_PROJECTS = {
  codeorg: {
    config_file: File.join(File.dirname(__FILE__), "codeorg_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg_files_to_sync_out.json")
  },
  "codeorg-markdown": {
    config_file: File.join(File.dirname(__FILE__), "codeorg_markdown_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-markdown_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-markdown_files_to_sync_out.json")
  },
  "hour-of-code": {
    config_file: File.join(File.dirname(__FILE__), "hourofcode_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "hour-of-code_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "hour-of-code_files_to_sync_out.json")
  },
  "codeorg-restricted": {
    config_file: File.join(File.dirname(__FILE__), "codeorg_restricted_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-restricted_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-restricted_files_to_sync_out.json")
  }
}

CROWDIN_TEST_PROJECTS = {
  "codeorg-testing": {
    config_file: File.join(File.dirname(__FILE__), "codeorg-testing_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-testing_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-testing_files_to_sync_out.json")
  },
  "codeorg-markdown-testing": {
    config_file: File.join(File.dirname(__FILE__), "codeorg-testing_markdown_crowdin.yml"),
    identity_file: File.join(File.dirname(__FILE__), "crowdin_credentials.yml"),
    etags_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-testing_markdown_etags.json"),
    files_to_sync_out_json: File.join(File.dirname(__FILE__), "crowdin", "codeorg-testing_markdown_files_to_sync_out.json")
  }
}

class I18nScriptUtils
  # Because we log many of the i18n operations to slack, we often want to
  # explicitly force stdout to operate synchronously, rather than buffering
  # output and dumping a whole lot of output into slack all at once.
  #
  # See the sync_up and sync_down methods in particular for usage.
  def self.with_synchronous_stdout
    old_sync = $stdout.sync
    $stdout.sync = true
    yield
    $stdout.sync = old_sync
  end

  # Output the given data to YAML that will be consumed by Crowdin. Includes a
  # couple changes to the default `data.to_yaml` serialization:
  #
  #   1. Don't wrap lines. This is an optional feature provided by yaml, intended
  #      to make human editing of the serialized data easier. Because this data
  #      is only managed programmatically, we avoid wrapping to make the git
  #      diffs smaller and change detection easier.
  #
  #   2. Quote 'y' and 'n'. Psych intentionally departs from the YAML spec for
  #      these strings: https://github.com/ruby/psych/blob/8e880f7837db9ed66032a1dddc85444a1514a1e3/test/psych/test_boolean.rb#L21-L35
  #      But Crowdin sticks strictly to the YAML spec, so here we add special
  #      logic to ensure that we conform to the spec when outputting for Crowdin
  #      consumption.
  #      See https://github.com/gvvaughan/lyaml/issues/8#issuecomment-123132430
  def self.to_crowdin_yaml(data)
    ast = Psych.parse_stream(Psych.dump(data))

    # Make sure we treat the strings 'y' and 'n' as strings, and not bools
    yaml_bool = /^(?:y|Y|n|N)$/
    # Make sure we use the right format for strings with '#' in them, otherwise
    # YAML parsers might treat part of the string as a YAML comment.
    octothorpe = /#/
    ast.grep(Psych::Nodes::Scalar).each do |node|
      if yaml_bool.match node.value
        node.plain = false
        node.quoted = true
      elsif octothorpe.match node.value
        node.plain = false
        node.quoted = true
        node.style = Psych::Nodes::Scalar::DOUBLE_QUOTED
      end
    end

    return ast.yaml(nil, {line_width: -1})
  end

  def self.git_add_and_commit(paths, commit_message)
    paths.each do |path|
      `git add #{path}`
    end
    `git commit -m "#{commit_message}"`
  end

  def self.run_standalone_script(location)
    Open3.popen3(location) do |_stdin, stdout, stderr, _wait_thread|
      while line = stdout.gets
        puts(line)
      end
      while line = stderr.gets
        puts(line)
      end
    end
  end

  def self.run_bash_script(location)
    I18nScriptUtils.run_standalone_script("bash #{location}")
  end

  def self.report_malformed_restoration(key, translation, file_name)
    @malformed_restorations ||= [["Key", "File Name", "Translation"]]
    @malformed_restorations << [key, file_name, translation]
  end

  def self.upload_malformed_restorations(locale)
    return if @malformed_restorations.blank?
    if CDO.gdrive_export_secret
      begin
        @google_drive ||= Google::Drive.new(service_account_key: StringIO.new(CDO.gdrive_export_secret.to_json))
        @google_drive.add_sheet_to_spreadsheet(@malformed_restorations, "i18n_bad_translations", locale)
      rescue
        puts "Failed to upload malformed restorations for #{locale}"
      end
    end
    @malformed_restorations = nil
  end

  def self.recursively_find_malformed_links_images(hash, key_str, file_name)
    hash.each do |key, val|
      if val.is_a?(Hash)
        I18nScriptUtils.recursively_find_malformed_links_images(val, "#{key_str}.#{key}", file_name)
      else
        I18nScriptUtils.report_malformed_restoration("#{key_str}.#{+key}", val, file_name) if I18nScriptUtils.contains_malformed_link_or_image(val)
      end
    end
  end

  # This function currently looks for
  # 1. Translations with malformed redaction syntax, i.e. [] [0] (note the space)
  # 2. Translations with similarly malformed markdown, i.e. [link] (example.com)
  # If this function finds either of these cases in the string, it return true.
  def self.contains_malformed_link_or_image(translation)
    malformed_redaction_regex = /\[.*\]\s+\[[0-9]+\]/
    malformed_markdown_regex = /\[.*\]\s+\(.+\)/
    non_malformed_redaction = (translation =~ malformed_redaction_regex).nil?
    non_malformed_translation = (translation =~ malformed_markdown_regex).nil?
    return !(non_malformed_redaction && non_malformed_translation)
  end

  def self.get_level_url_key(script, level)
    script_level = level.script_levels.find_by_script_id(script.id)
    path = script_level.build_script_level_path(script_level)
    URI.join("https://studio.code.org", path)
  end

  # Used by get_level_from_url, for the script_level-specific case.
  def self.get_script_level(route_params, url)
    script = Unit.get_from_cache(route_params[:script_id])
    unless script.present?
      error_class = 'Could not find script in get_script_level'
      error_message = "unknown script #{route_params[:script_id].inspect} for url #{url.inspect}"
      log_error(error_class, error_message)
      return nil
    end

    case route_params[:action]
    when "show"
      script_level = ScriptLevelsController.get_script_level(script, route_params)
      script_level&.level
    when "lesson_extras"
      # Copied from ScriptLevelsController.lesson_extras
      uri = URI.parse(url)
      uri_params = CGI.parse(uri.query)
      if uri_params.key?('id')
        script_level = Unit.cache_find_script_level(uri_params['id'].first)
        script_level&.level
      elsif uri_params.key?('level_name')
        Level.find_by_name(uri_params['level_name'].first)
      end
    else
      error_class = 'Could not identify route in get_script_level'
      error_message = "unknown route action #{route_params[:action].inspect} for url #{url.inspect}"
      log_error(error_class, error_message)
      nil
    end
  end

  # Given a code.org url, if it's a valid level url (including things like
  # projects), return the level identified by this url.
  #
  # Note that this may not cover 100% of the possible different kinds of level
  # urls; we expect to expand this function over time as new cases are
  # discovered.
  def self.get_level_from_url(url)
    # memoize to reduce repeated database interactions
    @levels_by_url ||= Hash.new do |hash, new_url|
      route_params = Rails.application.routes.recognize_path(new_url)

      level =
        case route_params[:controller]
        when "projects"
          Level.find_by_name(route_params[:key])
        when "script_levels"
          get_script_level(route_params, new_url)
        else
          error_class = 'Could not identify route in get_level_from_url'
          error_message = "unknown route #{route_params[:controller].inspect} for url #{new_url.inspect}"
          log_error(error_class, error_message)
        end

      unless level.present?
        error_class = 'Could not find level in get_level_from_url'
        error_message = "could not find level for url #{new_url.inspect}"
        log_error(error_class, error_message)
        next
      end

      hash[new_url] = level
    end

    @levels_by_url[url]
  end

  def self.write_markdown_with_header(markdown, header, path)
    File.open(path, 'w') do |f|
      unless header.empty?
        f.write(I18nScriptUtils.to_crowdin_yaml(header))
        f.write("---\n\n")
      end
      f.write(markdown)
    end
  end

  # Reduce the header metadata we include in markdown files down to just the
  # subset of content we want to allow translators to translate.
  #
  # Right now, this is just page titles but it could be expanded to include
  # any English content (description, social share stuff, etc).
  def self.sanitize_header!(header)
    header.slice!("title")
  end

  # If a script is updated such that its destination directory changes after
  # creation, we can end up in a situation in which we have multiple copies of
  # the script file in the repo, which makes it difficult for the sync out to
  # know which is the canonical version.
  #
  # To prevent that, here we proactively check for existing files in the
  # filesystem with the same filename as our target script file, but a
  # different directory. If found, we refuse to create the second such script
  # file and notify of the attempt, so the issue can be manually resolved.
  #
  # Note we could try here to remove the old version of the file both from the
  # filesystem and from github, but it would be significantly harder to also
  # remove it from Crowdin.
  def self.unit_directory_change?(script_i18n_name, script_i18n_filename)
    level_content_directory = "../#{I18N_SOURCE_DIR}/course_content"

    matching_files = Dir.glob(File.join(level_content_directory, "**", script_i18n_name)).reject do |other_filename|
      other_filename == script_i18n_filename
    end

    return false if matching_files.empty?

    # Clean up the file paths, just to make our output a little nicer
    base = Pathname.new(level_content_directory)
    relative_matching = matching_files.map {|filename| Pathname.new(filename).relative_path_from(base)}
    relative_new = Pathname.new(script_i18n_filename).relative_path_from(base)
    script_name = File.basename(script_i18n_name, '.*')
    error_class = 'Destination directory for script is attempting to change'
    error_message = "Script #{script_name} wants to output strings to #{relative_new}, but #{relative_matching.join(' and ')} already exists"
    log_error(error_class, error_message)
    return true
  end

  def self.log_error(error_class, error_message)
    # [FND-1667] Uncomment this once we have enabled Honeybadger usage on the i18n-dev server.
    # Honeybadger.notify(
    #   error_class: error_class,
    #   error_message: error_message
    # )
    puts "[#{error_class}] #{error_message}"
  end
end
