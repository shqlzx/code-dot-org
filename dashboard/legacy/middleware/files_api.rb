require 'active_support/core_ext/numeric/time'
require 'cdo/aws/s3'
require 'cdo/rack/request'
require 'sinatra/base'
require 'cdo/sinatra'
require 'cdo/image_moderation'
require 'nokogiri'

class FilesApi < Sinatra::Base
  set :mustermann_opts, check_anchors: false

  def max_file_size
    5_000_000 # 5 MB
  end

  def max_app_size
    2_000_000_000 # 2 GB
  end

  SOURCES_PUBLIC_CACHE_DURATION = 20.seconds

  def get_bucket_impl(endpoint)
    case endpoint
    when 'animations'
      AnimationBucket
    when 'assets'
      AssetBucket
    when 'files'
      FileBucket
    when 'sources'
      SourceBucket
    when 'libraries'
      LibraryBucket
    else
      not_found
    end
  end

  def can_view_abusive_assets?(encrypted_channel_id)
    return true if owns_channel?(encrypted_channel_id) || admin? || has_permission?('project_validator')

    # teachers can see abusive assets of their students
    owner_storage_id, _ = storage_decrypt_channel_id(encrypted_channel_id)
    owner_user_id = user_id_for_storage_id(owner_storage_id)

    teaches_student?(owner_user_id)
  end

  def codeprojects_can_view?(encrypted_channel_id)
    owner_storage_id, _ = storage_decrypt_channel_id(encrypted_channel_id)

    # Attempt to find active project in database. This will raise Projects::NotFound if
    # no active project exists, which is handled below.
    Projects.new(owner_storage_id).get(encrypted_channel_id)

    owner_user_id = user_id_for_storage_id(owner_storage_id)
    !get_user_sharing_disabled(owner_user_id)

  # Default to cannot view if there is an error
  rescue Projects::NotFound, ArgumentError, OpenSSL::Cipher::CipherError
    false
  end

  def can_view_profane_or_pii_assets?(encrypted_channel_id)
    owns_channel?(encrypted_channel_id) || admin? || has_permission?('project_validator')
  end

  def file_too_large(quota_type)
    # Don't record a custom event since these events may be very common.
    record_metric('FileTooLarge', quota_type)
    too_large
  end

  def quota_crossed_half_used?(app_size, body_length)
    (app_size < max_app_size / 2) && (app_size + body_length >= max_app_size / 2)
  end

  def quota_crossed_half_used(quota_type, encrypted_channel_id)
    quota_event_type = 'QuotaCrossedHalfUsed'
    record_metric(quota_event_type, quota_type)
    record_event(quota_event_type, quota_type, encrypted_channel_id)
  end

  def quota_exceeded(quota_type, encrypted_channel_id)
    quota_event_type = 'QuotaExceeded'
    record_metric(quota_event_type, quota_type)
    record_event(quota_event_type, quota_type, encrypted_channel_id)
    forbidden
  end

  def record_metric(quota_event_type, quota_type, value = 1)
    return unless CDO.newrelic_logging

    NewRelic::Agent.record_metric("Custom/FilesApi/#{quota_event_type}_#{quota_type}", value)
  end

  def record_event(quota_event_type, quota_type, encrypted_channel_id)
    return unless CDO.newrelic_logging

    owner_storage_id, _ = storage_decrypt_channel_id(encrypted_channel_id)
    owner_user_id = user_id_for_storage_id(owner_storage_id)
    event_details = {
      quota_type: quota_type,
      encrypted_channel_id: encrypted_channel_id,
      owner_user_id: owner_user_id
    }
    NewRelic::Agent.record_custom_event("FilesApi#{quota_event_type}", event_details)
  end

  helpers do
    %w(core.rb storage_id.rb).each do |file|
      load(CDO.dir('shared', 'middleware', 'helpers', file))
    end
  end

  helpers do
    %w(auth_helpers.rb bucket_helper.rb animation_bucket.rb file_bucket.rb asset_bucket.rb source_bucket.rb profanity_privacy_helper.rb library_bucket.rb).each do |file|
      load(CDO.dir('dashboard', 'legacy', 'middleware', 'helpers', file))
    end
  end

  set(:code_projects_domain) do |val|
    condition do
      (request.host == CDO.canonical_hostname('codeprojects.org')) == val
    end
  end

  #
  # GET /v3/(animations|assets|sources|libraries)/<channel-id>
  #
  # List filenames and sizes.
  #
  get %r{/v3/(animations|assets|sources|libraries)/([^/]+)$} do |endpoint, encrypted_channel_id|
    dont_cache
    content_type :json

    begin
      get_bucket_impl(endpoint).new.list(encrypted_channel_id).to_json
    rescue ArgumentError, OpenSSL::Cipher::CipherError
      bad_request
    end
  end

  #
  # GET /v3/(animations|assets|sources|files|libraries)/<channel-id>/<filename>?version=<version-id>
  #
  # Read a file. Optionally get a specific version instead of the most recent.
  # Note: we depend on this URL in Javabuilder
  # https://github.com/code-dot-org/javabuilder/blob/main/org-code-javabuilder/protocol/src/main/java/org/code/protocol/GlobalProtocol.java
  #
  get %r{/v3/(animations|assets|sources|files|libraries)/([^/]+)/([^/]+)$} do |endpoint, encrypted_channel_id, filename|
    if endpoint == 'libraries'
      dont_cache
    end
    get_file(endpoint, encrypted_channel_id, filename)
  end

  #
  # GET /v3/sources-public/<channel-id>/<filename>
  #
  # Read the latest version of a source file, and cache the response.
  #
  get %r{/v3/sources-public/([^/]+)/([^/]+)$} do |encrypted_channel_id, filename|
    get_file('sources', encrypted_channel_id, filename, cache_duration: SOURCES_PUBLIC_CACHE_DURATION)
  end

  #
  # GET /projects/<project-type>/<channel-id>/<filename>?version=<version-id>
  #
  # Read a file. Optionally get a specific version instead of the most recent.
  # Only from codeprojects.org domain
  #
  get %r{/projects/([a-z]+)/([^/]+)/([^/]+)$}, {code_projects_domain: true} do |project_type, encrypted_channel_id, filename|
    not_found unless project_type == 'weblab'
    pass unless valid_encrypted_channel_id(encrypted_channel_id)

    get_file('files', encrypted_channel_id, filename, true)
  end

  #
  # GET /projects/<project-type>/<channel-id>
  #
  # Redirect to /projects/<project-type>/<channel-id>/
  # Only from codeprojects.org domain
  #
  get %r{/projects/([a-z]+)/([^/]+)$}, {code_projects_domain: true} do |project_type, encrypted_channel_id|
    not_found unless project_type == 'weblab'
    pass unless valid_encrypted_channel_id(encrypted_channel_id)

    redirect "#{request.path_info}/"
  end
  #
  # GET /<channel-id>/
  #
  # Redirect to /projects/weblab/<channel-id>/
  # Only from codeprojects.org domain
  # Deprecated in favor of the URL below
  #
  get %r{/([^/]+)/?$}, {code_projects_domain: true} do |encrypted_channel_id|
    pass unless valid_encrypted_channel_id(encrypted_channel_id)

    redirect "/projects/weblab#{request.path_info}"
  end

  #
  # GET /projects/<project-type>/<channel-id>/
  #
  # Serve index.html for this project.
  # Only from codeprojects.org domain
  # Currently only supported for weblab
  #
  get %r{/projects/([a-z]+)/([^/]+)/$}, {code_projects_domain: true} do |project_type, encrypted_channel_id|
    not_found unless project_type == 'weblab'
    pass unless valid_encrypted_channel_id(encrypted_channel_id)

    get_file('files', encrypted_channel_id, 'index.html', true)
  end

  #
  # @return [IO] requested file body as an IO stream
  #
  def get_file(endpoint, encrypted_channel_id, filename, code_projects_domain_root_route = false, cache_duration: nil)
    # We occasionally serve HTML files through theses APIs - we don't want NewRelic JS inserted...
    NewRelic::Agent.ignore_enduser rescue nil

    buckets = get_bucket_impl(endpoint).new
    cache_duration ||= buckets.cache_duration_seconds
    set_object_cache_duration cache_duration

    # Append `no-transform` to existing Cache-Control header
    response['Cache-Control'] += ', no-transform'

    filename.downcase! if endpoint == 'files'
    not_found unless buckets.allowed_file_name? filename
    type = File.extname(filename)
    not_found if type.empty?
    unsupported_media_type unless buckets.allowed_file_type?(type)
    content_type type

    # Unless this is hosted by codeprojects.org or is a safely viewable file type,
    # serve all files with Content-Disposition set to attachment so browsers
    # will not render potential HTML content inline. User-generated content can
    # contain script that we don't want to host as authentic web content from
    # our domain.
    unless code_projects_domain_root_route || safely_viewable_file_type?(type)
      response.headers['Content-Disposition'] = "attachment; filename=\"#{filename}\""
    end

    result = buckets.get(encrypted_channel_id, filename, env['HTTP_IF_MODIFIED_SINCE'], request.GET['version'])
    not_found if result[:status] == 'NOT_FOUND'
    not_modified if result[:status] == 'NOT_MODIFIED'
    last_modified result[:last_modified]

    metadata = result[:metadata]
    abuse_score = [metadata['abuse_score'].to_i, metadata['abuse-score'].to_i].max
    not_found if abuse_score >= SharedConstants::ABUSE_CONSTANTS.ABUSE_THRESHOLD && !can_view_abusive_assets?(encrypted_channel_id)
    not_found if profanity_privacy_violation?(filename, result[:body]) && !can_view_profane_or_pii_assets?(encrypted_channel_id)
    not_found if code_projects_domain_root_route && !codeprojects_can_view?(encrypted_channel_id)

    if code_projects_domain_root_route && html?(response.headers)
      return "<head>\n<script>\nvar encrypted_channel_id='#{encrypted_channel_id}';\n</script>\n<script async src='/weblab/footer.js'></script>\n<link rel='stylesheet' href='/weblab/footer.css'></head>\n" << result[:body].string
    end

    response.headers['S3-Version-Id'] = result[:version_id]

    if endpoint == 'sources' && should_sanitize_for_under_13?(encrypted_channel_id)
      return StringIO.new sanitize_for_under_13 result[:body].string
    end

    result[:body]
  end

  # We should sanitize all sources created by under-13 users unless it is the
  # user themselves requesting to view the source
  def should_sanitize_for_under_13?(encrypted_channel_id)
    return false if owns_channel?(encrypted_channel_id)

    owner_storage_id, _ = storage_decrypt_channel_id(encrypted_channel_id)
    owner_id = user_id_for_storage_id(owner_storage_id)
    under_13?(owner_id)
  end

  # Perform sanitization for sources created by under-13 users.
  # Currently, all this does is remove any "comment" blocks, but it could easily
  # be expanded to provide more privacy options
  def sanitize_for_under_13(body_string)
    begin
      parsed_json = JSON.parse(body_string)
    rescue JSON::ParserError
      return body_string
    end

    return body_string unless parsed_json.key?('source')
    source_json = parsed_json['source']
    if source_json.is_a?(Hash)
      source_json = source_json.to_s
    end
    blockly_xml = Nokogiri::XML(source_json)
    return body_string unless blockly_xml.errors.empty?

    # first, remove all comment blocks by replacing them with the next block in
    # the hierarchy
    blockly_xml.xpath("//block[@type='comment']").each do |comment_block|
      next_block = (comment_block > "next") > "block"
      comment_block.replace(next_block)
    end

    # then, remove all empty "next" blocks
    blockly_xml.xpath("//next").each do |next_block|
      next_block.remove if next_block.children.empty?
    end

    # finally, write the modified xml back out to json
    new_source = blockly_xml.serialize({save_with: Nokogiri::XML::Node::SaveOptions::NO_DECLARATION}).strip
    parsed_json['source'] = new_source

    parsed_json.to_json
  end

  # A list of some file types that are safe to view in the browser without
  # risking script execution. Initially limited to images since it is useful
  # to view these via the browser context menu.
  def safely_viewable_file_type?(extension)
    %w(.jpg .jpeg .gif .png).include? extension.downcase
  end

  CONTENT_TYPE = 'Content-Type'.freeze
  TEXT_HTML = 'text/html'.freeze

  def html?(headers)
    headers[CONTENT_TYPE]&.include?(TEXT_HTML)
  end

  def html_file?(filename)
    File.extname(filename&.downcase) == '.html'
  end

  def valid_html_content?(body)
    disallowed_tags = DCDO.get('disallowed_html_tags', [])

    # Applicable Nokogiri selector rules:
    #   Element selectors must start with //
    #   Attribute selectors must start with @
    #   (Example: "//div[@name]" will return all <div>s that have a 'name' attribute.)
    disallowed_tag_selectors = disallowed_tags.map do |tag|
      tag_dup = tag.dup
      attr_selector_index = tag_dup.index('[')
      tag_dup.insert(attr_selector_index + 1, '@') if attr_selector_index
      '//' + tag_dup
    end

    Nokogiri::HTML(body).xpath(*disallowed_tag_selectors).empty?
  end

  # Determine whether or not a file is a valid HTML file.
  # Returns true if:
  #   1. It does not belong to a WebLab project.
  #   2. It belongs to a WebLab project and does not contain disallowed HTML tags.
  # Returns false if the file is not an HTML file, does not belong to a project, or
  # is a WebLab HTML file that contains disallowed HTML tags.
  def valid_html_file?(encrypted_channel_id, filename, body)
    return false unless html_file?(filename)

    # Only validate WebLab HTML files. We need to get the project from the database
    # in order to check whether or not the file belongs to a WebLab project.
    project = Projects.new(get_storage_id).get(encrypted_channel_id)
    return false unless project
    return true unless project[:projectType]&.downcase == 'weblab'

    valid_html_content?(body)
  end

  #
  # Set appropriate cache headers for making the retrieved object cached
  # for the given number of seconds
  # @param [Int] duration_seconds
  def set_object_cache_duration(duration_seconds)
    if duration_seconds == 0
      dont_cache
    else
      cache_for duration_seconds
    end
  end

  def put_file(endpoint, encrypted_channel_id, filename, body)
    not_authorized unless owns_channel?(encrypted_channel_id)
    file_type = File.extname(filename)
    buckets = get_bucket_impl(endpoint).new
    if body.length >= max_file_size
      body = buckets.try_resize_file(body, file_type)
    end

    file_too_large(endpoint) unless body.length < max_file_size

    bad_request unless buckets.allowed_file_name? filename

    # verify that file type is in our allowlist, and that the user-specified
    # mime type matches what Sinatra expects for that file type.
    unsupported_media_type unless buckets.allowed_file_type?(file_type)
    category = buckets.category_from_file_type(file_type)

    # sources only supports one file (main.json) and we checked max_file_size above,
    # so there's no need to check if we've exceeded the max total app size for the sources bucket.
    unless 'sources' == endpoint
      app_size = buckets.app_size(encrypted_channel_id)
      quota_exceeded(endpoint, encrypted_channel_id) unless app_size + body.length < max_app_size
      quota_crossed_half_used(endpoint, encrypted_channel_id) if quota_crossed_half_used?(app_size, body.length)
    end

    # Block libraries with PII/profanity from being published.
    #
    # Javalab's "backpack" feature uses libraries to allow students to share code
    # between their own projects -- skip this check for .java files, since in this use case
    # the files are only being used by a single user.
    if endpoint == 'libraries' && file_type != '.java'
      begin
        share_failure = ShareFiltering.find_failure(body, request.locale)
      rescue OpenURI::HTTPError => e
        return file_too_large(endpoint) if e.message == "414 Request-URI Too Large"
      end
      # TODO(JillianK): we are temporarily ignoring address share failures because our address detection is very broken.
      # Once we have a better geocoding solution in H1, we should start filtering for addresses again.
      # Additional context: https://codedotorg.atlassian.net/browse/STAR-1361
      return bad_request if share_failure && share_failure[:type] != "address"
    end

    # Don't allow project to be saved if it contains non-UTF-8 characters (causing error / project to not load when opened).
    if 'sources' == endpoint
      body_json = JSON.parse(body)
      source = body_json["source"]
      html = body_json["html"]

      source_is_valid = source && has_valid_encoding?(source)
      # HTML only exists for AppLab projects
      html_is_valid = html ? source.force_encoding("UTF-8").valid_encoding? : true

      return status(422) unless source_is_valid && html_is_valid
    end

    # Replacing a non-current version of main.json could lead to perceived data loss.
    # Log to firehose so that we can better troubleshoot issues in this case.

    # TODO(dave): stop checking for 'version' once all clients have started using
    # 'replace' and 'currentVersion'.
    current_version = params['version'] || params['currentVersion']
    should_replace = params['replace'] == 'true'
    version_to_replace = params['version'] || (should_replace && params['currentVersion']) unless endpoint == 'assets'

    timestamp = params['firstSaveTimestamp']
    tab_id = params['tabId']
    conflict unless buckets.check_current_version(encrypted_channel_id, filename, current_version, should_replace, timestamp, tab_id, current_user_id)

    abuse_score = Projects.get_abuse(encrypted_channel_id)

    response = buckets.create_or_replace(encrypted_channel_id, filename, body, version_to_replace, abuse_score)

    {
      filename: filename,
      category: category,
      size: body.length,
      versionId: response.version_id,
      timestamp: Time.now # for logging purposes
    }.to_json
  end

  def has_valid_encoding?(source)
    if source.is_a?(String)
      return source.force_encoding("UTF-8").valid_encoding?
    end

    # Handle Multi-file Projects, like Java Lab
    if source.is_a?(Hash)
      # Iterate over each file
      source.each_key do |key|
        # Multi-file source structure:
        # {"source":{"MyClass.java":{"text":"“public class ClassName: {...<code here>...}”","isVisible":true}}
        return false unless source[key]["text"]&.force_encoding("UTF-8")&.valid_encoding?
      end
      return true
    end

    # If source is an unexpected type, return false to trigger a bad_request response
    return false
  end

  #
  # Create a new file from an existing source file within the specified channel.
  #
  # @param [String] endpoint - One of sources/assets/animations
  # @param [String] encrypted_channel_id - Token for app channel
  # @param [String] filename - Destination filename for file to be created
  # @param [String] source_filename - Filename of file to be copied
  # @return [String] JSON containing details for new file
  #
  def copy_file(endpoint, encrypted_channel_id, filename, source_filename)
    not_authorized unless owns_channel?(encrypted_channel_id)

    buckets = get_bucket_impl(endpoint).new
    bad_request unless buckets.allowed_file_name? filename

    # verify that file type is in our allowlist, and that the user-specified
    # mime type matches what Sinatra expects for that file type.
    file_type = File.extname(filename)
    unsupported_media_type unless buckets.allowed_file_type?(file_type)
    category = buckets.category_from_file_type(file_type)

    # Get the app size and size of the source object to check app quotas
    source_size, app_size = buckets.object_and_app_size(encrypted_channel_id, source_filename)
    # If the source object doesn't exist, reject the request
    not_found if source_size.nil?

    quota_exceeded(endpoint, encrypted_channel_id) unless app_size + source_size < max_app_size
    quota_crossed_half_used(endpoint, encrypted_channel_id) if quota_crossed_half_used?(app_size, source_size)

    response = buckets.copy(encrypted_channel_id, filename, source_filename)

    {filename: filename, category: category, size: source_size, versionId: response.version_id}.to_json
  end

  #
  # PUT /v3/(sources)/<channel-id>/<filename>?version=<version-id>
  # PUT /v3/(assets|libraries)/<channel-id>/<filename>
  #
  # Create or replace a file. For sources endpoint, optionally overwrite a specific version.
  #
  put %r{/v3/(sources|assets|libraries)/([^/]+)/([^/]+)$} do |endpoint, encrypted_channel_id, filename|
    dont_cache
    content_type :json

    # read the entire request before considering rejecting it, otherwise varnish
    # may return a 503 instead of whatever status code we specify. Unfortunately
    # this prevents us from rejecting large files based on the Content-Length
    # header.
    body = request.body.read

    put_file(endpoint, encrypted_channel_id, filename, body)
  end

  # POST /v3/assets/<channel-id>/
  #
  # Upload a new file. We use this method so that IE9 can still upload by
  # posting to an iframe.
  #
  post %r{/v3/assets/([^/]+)/$} do |encrypted_channel_id|
    dont_cache
    # though this is JSON data, we're making the POST request via iframe
    # form submission. IE9 will try to download the response if we have
    # content_type json
    content_type 'text/plain'

    bad_request unless request.POST['files'] && request.POST['files'][0]

    file = request.POST['files'][0]

    bad_request unless file[:filename] && file[:tempfile]

    filename = BucketHelper.replace_unsafe_chars(file[:filename])
    put_file('assets', encrypted_channel_id, filename, file[:tempfile].read)
  end

  # POST /v3/copy-assets/<channel-id>?src_channel=<src-channel-id>&src_files=<src-filenames-json>
  #
  # Copy assets from another channel. Note that when specifying the src files, you must
  # json encode it
  #
  post %r{/v3/copy-assets/([^/]+)$} do |encrypted_channel_id|
    dont_cache
    AssetBucket.new.copy_files(
      request['src_channel'],
      encrypted_channel_id,
      {filenames: JSON.parse(request['src_files'])}
    ).to_json
  end

  # POST /v3/animations/<channel-id>/<filename>?version=<version-id>
  #
  # Create or replace an animation. We use this method so that IE9 can still
  # upload by posting to an iframe.
  #
  post %r{/v3/(animations)/([^/]+)/([^/]+)$} do |endpoint, encrypted_channel_id, filename|
    dont_cache
    # though this is JSON data, we're making the POST request via iframe
    # form submission. IE9 will try to download the response if we have
    # content_type json
    content_type 'text/plain'

    bad_request unless request.POST['files'] && request.POST['files'][0]

    file = request.POST['files'][0]

    bad_request unless file[:filename] && file[:tempfile]

    put_file(endpoint, encrypted_channel_id, filename, file[:tempfile].read)
  end

  # PUT /v3/animations/<channel-id>/<filename>?src=<source-filename>
  #
  # Create or replace an animation.
  #
  put %r{/v3/(animations)/([^/]+)/([^/]+)$} do |endpoint, encrypted_channel_id, filename|
    dont_cache
    content_type 'text/plain'
    if request.content_type == 'image/png'
      body = request.body.read
      put_file(endpoint, encrypted_channel_id, filename, body)
    elsif !request.GET['src'].nil?
      # We use this method so that IE9 can still upload by posting to an iframe.
      copy_file(endpoint, encrypted_channel_id, filename, request.GET['src'])
    else
      bad_request
    end
  end

  #
  # PATCH /v3/(animations|assets|sources|files|libraries)/<channel-id>?abuse_score=<abuse_score>
  #
  # Update all assets for the given channelId to have the provided abuse score
  #
  # Endpoint removed. Functionality moved to ReportAbuseController.
  #

  #
  # DELETE /v3/(animations|assets|sources|libraries)/<channel-id>/<filename>
  #
  # Delete a file.
  #
  delete %r{/v3/(animations|assets|sources|libraries)/([^/]+)/([^/]+)$} do |endpoint, encrypted_channel_id, filename|
    dont_cache

    not_authorized unless owns_channel?(encrypted_channel_id)

    get_bucket_impl(endpoint).new.delete(encrypted_channel_id, filename)
    no_content
  end

  #
  # GET /v3/(animations|sources|files|libraries)/<channel-id>/<filename>/versions
  #
  # List versions of the given file.
  # NOTE: Not yet implemented for assets.
  #
  get %r{/v3/(animations|sources|files|libraries)/([^/]+)/([^/]+)/versions$} do |endpoint, encrypted_channel_id, filename|
    dont_cache
    content_type :json

    filename.downcase! if endpoint == 'files'
    get_bucket_impl(endpoint).new.list_versions(encrypted_channel_id, filename, with_comments: request.GET['with_comments']).to_json
  end

  #
  # PUT /v3/sources/<channel-id>/<filename>/restore?version=<version-id>
  #
  # Copies the given version of the source to make it the current revision.
  #
  put %r{/v3/sources/([^/]+)/([^/]+)/restore$} do |encrypted_channel_id, filename|
    dont_cache
    content_type :json

    not_authorized unless owns_channel?(encrypted_channel_id)

    SourceBucket.new.restore_previous_version(encrypted_channel_id, filename, request.GET['version'], current_user_id).to_json
  end

  #
  # GET /v3/files/<channel-id>?version=<version-id>
  #
  # List filenames and sizes.
  #
  get %r{/v3/files/([^/]+)$} do |encrypted_channel_id|
    dont_cache
    content_type :json

    bucket = FileBucket.new
    result = bucket.get(encrypted_channel_id, FileBucket::MANIFEST_FILENAME, env['HTTP_IF_MODIFIED_SINCE'], params['version'])
    not_found if result[:status] == 'NOT_FOUND'
    not_modified if result[:status] == 'NOT_MODIFIED'
    last_modified result[:last_modified]

    # {
    #   "filesVersionId": "sadfhkjahfsdj",
    #   "files": [
    #     {
    #       "filename": "name.jpg",
    #       "category": "image",
    #       "size": 100,
    #       "versionId": "asldfklsakdfj"
    #     }
    #   ]
    # }
    {filesVersionId: result[:version_id], files: JSON.parse(result[:body].read)}.to_json
  end

  #
  # NOTE: The files API that we expose is case-insensitive, though AWS s3 is case-sensitive. As a
  # result, we normalize s3 filenames to be downcased. That said, we maintain a case-sensitive
  # manifest.
  #
  def files_put_file(encrypted_channel_id, filename, body)
    # Rename .jfif file extensions to .jpg because Sinatra does not support .jfif file types.
    # .jfif files use the same protocol as .jpg files, which is why rename-only is sufficient.
    filename.gsub!(/(.jfif|.JFIF)/, '.jpg') if File.extname(filename.downcase) == '.jfif'

    unescaped_filename = CGI.unescape(filename)
    unescaped_filename_downcased = unescaped_filename.downcase
    bad_request if unescaped_filename_downcased == FileBucket::MANIFEST_FILENAME
    bad_request if unescaped_filename_downcased.length > FileBucket::MAXIMUM_FILENAME_LENGTH
    bad_request if html_file?(unescaped_filename) && !valid_html_file?(encrypted_channel_id, unescaped_filename, body)

    bucket = FileBucket.new
    manifest = get_manifest(bucket, encrypted_channel_id)
    manifest_is_unchanged = true

    unescaped_src_filename_downcased = params['src'] ? CGI.unescape(params['src']).downcase : nil
    unescaped_delete_filename_downcased = params['delete'] ? CGI.unescape(params['delete']).downcase : nil
    case_only_rename = unescaped_filename_downcased == unescaped_src_filename_downcased

    # store the new file
    if unescaped_src_filename_downcased
      if case_only_rename
        src_entry = manifest.detect {|e| e['filename'].downcase == unescaped_filename_downcased}
        not_found if src_entry.nil?
        new_entry_json = src_entry.to_json
      else
        new_entry_json = copy_file(
          'files',
          encrypted_channel_id,
          CGI.escape(unescaped_filename_downcased),
          CGI.escape(unescaped_src_filename_downcased)
        )
      end
    else
      new_entry_json = put_file('files', encrypted_channel_id, CGI.escape(unescaped_filename_downcased), body)
    end
    new_entry_hash = JSON.parse new_entry_json
    # Replace downcased filename with original filename (to preserve case in the manifest)
    new_entry_hash['filename'] = unescaped_filename

    existing_entry = manifest.detect {|e| e['filename'].downcase == unescaped_filename_downcased}
    if existing_entry.nil?
      manifest << new_entry_hash
      manifest_is_unchanged = false
    elsif existing_entry != new_entry_hash
      existing_entry.merge!(new_entry_hash)
      manifest_is_unchanged = false
    end

    deleting_separate_file = unescaped_delete_filename_downcased &&
      unescaped_delete_filename_downcased != unescaped_filename_downcased
    # if we're also deleting a file (on rename), remove it from the manifest (don't remove from manifest)
    if deleting_separate_file
      reject_result = manifest.reject! {|e| e['filename'].downcase == unescaped_delete_filename_downcased}
      manifest_is_unchanged = false unless reject_result.nil?
    end

    # write the manifest (assuming the entry changed)
    unless manifest_is_unchanged
      abuse_score = Projects.get_abuse(encrypted_channel_id)

      response = bucket.create_or_replace(
        encrypted_channel_id,
        FileBucket::MANIFEST_FILENAME,
        manifest.to_json,
        params['files-version'],
        abuse_score
      )
      new_entry_hash['filesVersionId'] = response.version_id
    end

    # delete a file if requested (same as src file in a rename operation)
    if deleting_separate_file
      bucket.delete(encrypted_channel_id, CGI.escape(unescaped_delete_filename_downcased))
    end

    # return the new entry info
    new_entry_hash.to_json
  end

  # POST /v3/files/<channel-id>/?version=<version-id>&files-version=<project-version-id>
  #
  # Create or replace a file. We use this method so that IE9 can still
  # upload by posting to an iframe.
  #
  post %r{/v3/files/([^/]+)/$} do |encrypted_channel_id|
    dont_cache
    # though this is JSON data, we're making the POST request via iframe
    # form submission. IE9 will try to download the response if we have
    # content_type json
    content_type 'text/plain'

    bad_request unless request.POST['files'] && request.POST['files'][0]

    file = request.POST['files'][0]

    bad_request unless file[:filename] && file[:tempfile]

    filename = BucketHelper.replace_unsafe_chars(file[:filename])
    files_put_file(encrypted_channel_id, filename, file[:tempfile].read)
  end

  #
  # PUT /v3/files/<channel-id>/<filename>?version=<version-id>&files-version=<project-version-id>
  #
  # Create or replace a file. Optionally overwrite a specific version.
  #
  put %r{/v3/files/([^/]+)/([^/]+)$} do |encrypted_channel_id, filename|
    dont_cache
    content_type :json

    if params['src'].nil?
      # read the entire request before considering rejecting it, otherwise varnish
      # may return a 503 instead of whatever status code we specify. Unfortunately
      # this prevents us from rejecting large files based on the Content-Length
      # header.
      body = request.body.read
    end

    files_put_file(encrypted_channel_id, filename, body)
  end

  #
  # DELETE /v3/files/<channel-id>/*?files-version=<project-version-id>
  #
  # Delete all files.
  #
  delete %r{/v3/files/([^/]+)/\*$} do |encrypted_channel_id|
    dont_cache
    content_type :json

    not_authorized unless owns_channel?(encrypted_channel_id)

    # read the manifest
    bucket = FileBucket.new
    manifest_result = bucket.get(encrypted_channel_id, FileBucket::MANIFEST_FILENAME)
    not_found if manifest_result[:status] == 'NOT_FOUND'
    manifest = JSON.parse(manifest_result[:body].read)

    # delete the manifest and all of the files it referenced
    bucket.delete_multiple(encrypted_channel_id, [FileBucket::MANIFEST_FILENAME].concat(manifest.map {|e| e['filename'].downcase})) unless manifest.empty?
    no_content
  end

  #
  # DELETE /v3/files/<channel-id>/<filename>?files-version=<project-version-id>
  #
  # Delete a file.
  #
  delete %r{/v3/files/([^/]+)/([^/]+)$} do |encrypted_channel_id, filename|
    dont_cache
    content_type :json

    bad_request if filename.downcase == FileBucket::MANIFEST_FILENAME

    not_authorized unless owns_channel?(encrypted_channel_id)

    # read the manifest
    bucket = FileBucket.new
    manifest_result = bucket.get(encrypted_channel_id, FileBucket::MANIFEST_FILENAME)
    not_found if manifest_result[:status] == 'NOT_FOUND'
    manifest = JSON.parse(manifest_result[:body].read)

    # remove the file from the manifest
    manifest_delete_comparison_filename = CGI.unescape(filename).downcase
    reject_result = manifest.reject! {|e| e['filename'].downcase == manifest_delete_comparison_filename}
    not_found if reject_result.nil?

    abuse_score = Projects.get_abuse(encrypted_channel_id)

    # write the manifest
    response = bucket.create_or_replace(encrypted_channel_id, FileBucket::MANIFEST_FILENAME, manifest.to_json, params['files-version'], abuse_score)

    # delete the file
    bucket.delete(encrypted_channel_id, filename.downcase)

    {filesVersionId: response.version_id}.to_json
  end

  #
  # GET /v3/files-version/<channel-id>
  #
  # List versions of the project.
  #
  get %r{/v3/files-version/([^/]+)$} do |encrypted_channel_id|
    dont_cache
    content_type :json

    FileBucket.new.list_versions(encrypted_channel_id, FileBucket::MANIFEST_FILENAME).to_json
  end

  #
  # PUT /v3/files-version/<channel-id>?version=<version-id>
  #
  # Restore project files to the state of a previous version id.
  #
  put %r{/v3/files-version/([^/]+)$} do |encrypted_channel_id|
    dont_cache
    content_type :json

    not_authorized unless owns_channel?(encrypted_channel_id)

    # read the manifest using the version-id specified
    bucket = FileBucket.new
    manifest_result = bucket.get(encrypted_channel_id, FileBucket::MANIFEST_FILENAME, nil, params['version'])
    bad_request if manifest_result[:status] == 'NOT_FOUND'
    manifest = JSON.parse(manifest_result[:body].read)

    # restore the files based on the versions stored in the manifest
    manifest.each do |entry|
      # TODO: (cpirich) optimization possible to avoid restoring if versionId matches current version
      response = bucket.restore_file_version(encrypted_channel_id, entry['filename'].downcase, entry['versionId'])
      entry['versionId'] = response.version_id
    end

    abuse_score = Projects.get_abuse(encrypted_channel_id)

    # save the new manifest
    manifest_json = manifest.to_json
    result = bucket.create_or_replace(encrypted_channel_id, FileBucket::MANIFEST_FILENAME, manifest_json, nil, abuse_score)

    {filesVersionId: result[:version_id], files: manifest}.to_json
  end

  #
  # Metadata Files
  #
  # Metadata files store information about a project which should not be exposed
  # in the user's file list.
  #
  # Metadata files are stored in the files API under the .metadata/ top-level directory.
  # Currently, the files API does not allow subdirectories, so there is no possible
  # conflict between metadata files and user files. Once subdirectories are supported,
  # the .metadata/ directory name must be reserved to prevent conflicts.
  #
  # Initially, metadata files are not stored in the manifest and are therefore not tied
  # to any version of the manifest file. In the future, if versions are needed (e.g. to
  # show thumbnail images in the Version History dialog), metadata files can be added to
  # a new "metadata" section of the manifest.
  #

  METADATA_PATH = '.metadata'.freeze
  THUMBNAIL_FILENAME = 'thumbnail.png'
  METADATA_FILENAMES = [THUMBNAIL_FILENAME].freeze

  #
  # PUT /v3/files/<channel-id>/.metadata/<filename>?version=<version-id>
  #
  # Create or replace a metadata file. Optionally overwrite a specific version.
  #
  put %r{/v3/files/([^/]+)/.metadata/([^/]+)$} do |encrypted_channel_id, filename|
    dont_cache
    content_type :json

    # read the entire request before considering rejecting it, otherwise varnish
    # may return a 503 instead of whatever status code we specify. Unfortunately
    # this prevents us from rejecting large files based on the Content-Length
    # header.
    body = request.body.read

    bad_request unless METADATA_FILENAMES.include?(filename)
    filename = "#{METADATA_PATH}/#{filename}"

    put_file('files', encrypted_channel_id, filename, body)
  end

  #
  # GET /v3/files/<channel-id>/.metadata/<filename>?version=<version-id>
  #
  # Read a metadata file. Optionally get a specific version instead of the most recent.
  #
  get %r{/v3/files/([^/]+)/.metadata/([^/]+)$} do |encrypted_channel_id, filename|
    get_file('files', encrypted_channel_id, "#{METADATA_PATH}/#{filename}")
  end

  MODERATE_THUMBNAILS_FOR_PROJECT_TYPES = %w(
    applab
    gamelab
  )

  #
  # GET /v3/files-public/<channel-id>/.metadata/<filename>?version=<version-id>
  #
  # Read a metadata file, caching the result for 1 hour.
  #
  get %r{/v3/files-public/([^/]+)/.metadata/([^/]+)$} do |encrypted_channel_id, filename|
    s3_prefix = "#{METADATA_PATH}/#{filename}"
    file = get_file('files', encrypted_channel_id, s3_prefix)

    if THUMBNAIL_FILENAME == filename
      project = Projects.new(get_storage_id)
      project_type = project.project_type_from_channel_id(encrypted_channel_id)
      if moderate_type?(project_type) && moderate_channel?(encrypted_channel_id)
        file_mime_type = mime_type(File.extname(filename.downcase))
        rating = ImageModeration.rate_image(file, file_mime_type, request.fullpath)

        case rating
        when :adult, :racy
          # Incrementing abuse score by 15 to differentiate from manually reported projects
          new_score = project.increment_abuse(encrypted_channel_id, 15)
          FileBucket.new.replace_abuse_score(encrypted_channel_id, s3_prefix, new_score)
          response.headers['x-cdo-content-rating'] = rating.to_s
          cache_for 1.hour
          not_found
          return
        when :unknown
          # Content moderation was unable to scan the image, usually because we've exceeded
          # the moderation service's request limit.  Return the default image for now and
          # cache for 1-2 minutes to spread out future requests to the moderation service.
          cache_for rand(60..120).seconds
          send_file apps_dir('/static/projects/project_default.png'), type: 'image/png'
          return
        end
      end
    end

    cache_for 1.hour
    # Because we _might_ have already read from this IO object during image
    # moderation, rewind to the start of the file before responding with it.
    file.seek(0, IO::SEEK_SET)
    file
  end

  #
  # DELETE /v3/files/<channel-id>/.metadata/<filename>?files-version=<project-version-id>
  #
  # Delete a metadata file.
  #
  delete %r{/v3/files/([^/]+)/.metadata/([^/]+)$} do |encrypted_channel_id, filename|
    dont_cache

    bad_request unless METADATA_FILENAMES.include? filename
    filename = "#{METADATA_PATH}/#{filename}"

    not_authorized unless owns_channel?(encrypted_channel_id)

    FileBucket.new.delete(encrypted_channel_id, filename)
    no_content
  end

  private

  #
  # Returns the (parsed) manifest associated with the given encrypted_channel_id.
  #
  def get_manifest(bucket, encrypted_channel_id)
    bucket.get_manifest(encrypted_channel_id)
  end

  def moderate_type?(project_type)
    MODERATE_THUMBNAILS_FOR_PROJECT_TYPES.include?(project_type)
  end

  def moderate_channel?(encrypted_channel_id)
    project = Projects.new(get_storage_id)
    !project.content_moderation_disabled?(encrypted_channel_id)
  end
end
