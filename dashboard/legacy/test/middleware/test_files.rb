require_relative 'files_api_test_base' # Must be required first to establish load paths
require_relative 'files_api_test_helper'
require 'cdo/aws/s3'

class FilesTest < FilesApiTestBase
  def setup
    NewRelic::Agent.reset_stub
    @channel_id = create_channel
    @api = FilesApiTestHelper.new(current_session, 'files', @channel_id)
    @api.ensure_aws_credentials
    AWS::S3.create_client
    Aws::S3::Client.expects(:new).never
  end

  def teardown
    # Require that tests delete the assets they upload
    get "v3/files/#{@channel_id}"
    assert not_found?
    delete_channel(@channel_id)
    @channel_id = nil
  end

  def test_copy_object
    file_data = 'fake-file-data'
    old_filename = @api.randomize_filename 'old_file.html'
    new_filename = @api.randomize_filename 'new_file.html'
    delete_all_file_versions old_filename, CGI.escape(old_filename),
      new_filename, CGI.escape(new_filename)
    delete_all_manifest_versions
    post_file_data @api, old_filename, file_data, 'test/html'

    @api.copy_object old_filename, new_filename

    assert successful?
    @api.get_object(new_filename)
    assert successful?
    assert_equal file_data, last_response.body
    @api.get_object(old_filename)
    assert successful?
    assert_equal file_data, last_response.body

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.object_and_app_size
    )

    delete_all_manifest_versions
  end

  def test_rename_object
    file_data = 'fake-file-data'
    old_filename = @api.randomize_filename 'old_file.html'
    new_filename = @api.randomize_filename 'new_file.html'
    delete_all_file_versions old_filename, CGI.escape(old_filename),
      new_filename, CGI.escape(new_filename)
    delete_all_manifest_versions
    post_file_data @api, old_filename, file_data, 'test/html'

    @api.rename_object old_filename, new_filename
    assert successful?
    @api.get_object(new_filename)
    assert successful?
    assert_equal file_data, last_response.body
    @api.get_object(old_filename)
    assert not_found?

    @api.delete_object(new_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.object_and_app_size
    )

    delete_all_manifest_versions
  end

  def test_rename_object_filename_too_long
    file_data = 'fake-file-data'
    old_filename = @api.randomize_filename 'old_file.html'
    new_filename = "long_filename#{'_' * 512}.html"
    delete_all_file_versions old_filename, CGI.escape(old_filename)
    delete_all_manifest_versions
    post_file_data @api, old_filename, file_data, 'test/html'

    @api.rename_object old_filename, new_filename
    assert bad_request?
    @api.get_object(new_filename)
    assert not_found?
    @api.get_object(old_filename)
    assert successful?
    assert_equal file_data, last_response.body

    @api.delete_object(old_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_upload_files
    dog_image_filename = @api.randomize_filename('dog.png')
    dog_image_body = 'stub-dog-contents'
    cat_image_filename = @api.randomize_filename('cat.png')
    cat_image_body = 'stub-cat-contents'
    hamster_image_filename = @api.randomize_filename('hamster.jfif')
    hamster_image_body = 'stub-hamster-contents'

    # Make sure we have a clean starting point
    delete_all_file_versions(dog_image_filename, cat_image_filename)
    delete_all_manifest_versions

    # Upload dog.png and check the response
    response = post_file_data(@api, dog_image_filename, dog_image_body, 'image/png')
    actual_dog_image_info = JSON.parse(response)
    expected_dog_image_info = {
      'filename' => dog_image_filename,
      'category' => 'image',
      'size' => dog_image_body.length
    }
    assert_fileinfo_equal(expected_dog_image_info, actual_dog_image_info)

    # Upload cat.png and check the response
    response = post_file_data(@api, cat_image_filename, cat_image_body, 'image/png')
    actual_cat_image_info = JSON.parse(response)
    expected_cat_image_info = {
      'filename' => cat_image_filename,
      'category' => 'image',
      'size' => cat_image_body.length
    }
    assert_fileinfo_equal(expected_cat_image_info, actual_cat_image_info)

    # Upload hamster.jfif and check the response
    response = post_file_data(@api, hamster_image_filename, hamster_image_body, 'image/jpg')
    actual_hamster_image_info = JSON.parse(response)
    expected_hamster_image_info = {
      'filename' => hamster_image_filename.sub('.jfif', '.jpg'),
      'category' => 'image',
      'size' => hamster_image_body.length
    }
    assert_fileinfo_equal(expected_hamster_image_info, actual_hamster_image_info)

    file_infos = @api.list_objects
    assert_fileinfo_equal(actual_dog_image_info, file_infos['files'][0])
    assert_fileinfo_equal(actual_cat_image_info, file_infos['files'][1])

    @api.get_object(dog_image_filename)
    assert_match 'private, must-revalidate, max-age=0', last_response['Cache-Control']
    assert_equal dog_image_body, last_response.body

    @api.get_codeproject_object(dog_image_filename, '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert_equal dog_image_body, last_response.body

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(dog_image_filename)
    assert successful?

    @api.delete_object(cat_image_filename)
    assert successful?

    delete_all_manifest_versions
  end

  def test_upload_html_file
    # Mocha requires that all calls to DCDO.get be stubbed in order to stub the return value
    # for DCDO.get('disallowed_html_tags', []), which is the only call we care about in this test.
    DCDO.stubs(:get).with('disallowed_html_tags', []).returns(['script', 'meta[http-equiv]'])
    DCDO.stubs(:get).with('s3_timeout', 15).returns(15)
    DCDO.stubs(:get).with('s3_slow_request', 15).returns(15)

    filename = 'index.html'
    # The below HTML is valid/invalid in WebLab projects only. Other project types do not
    # follow the same validity rules.
    valid_html = '<div></div>'
    invalid_html_1 = '<script src="index.js"></script>'
    invalid_html_2 = '<meta http-equiv="refresh">'

    # WebLab
    Projects.any_instance.stubs(:get).returns({projectType: 'weblab'})
    @api.put_object(filename, valid_html)
    assert successful?
    @api.delete_object(filename)

    @api.put_object(filename, invalid_html_1)
    assert bad_request?
    @api.delete_object(filename)

    @api.put_object(filename, invalid_html_2)
    assert bad_request?
    @api.delete_object(filename)

    # Not WebLab
    Projects.any_instance.stubs(:get).returns({projectType: 'applab'})
    @api.put_object(filename, valid_html)
    assert successful?
    @api.delete_object(filename)

    @api.put_object(filename, invalid_html_1)
    assert successful?
    @api.delete_object(filename)

    # This means the channel_id does not belong to a valid project.
    # These requests should always return a 400.
    Projects.any_instance.stubs(:get).returns(nil)
    @api.put_object(filename, valid_html)
    assert bad_request?
    @api.delete_object(filename)

    @api.put_object(filename, invalid_html_1)
    assert bad_request?
    @api.delete_object(filename)

    Projects.any_instance.unstub(:get)
    delete_all_manifest_versions
  end

  def test_content_disposition
    dog_image_filename = @api.randomize_filename('dog.png')
    dog_image_body = 'stub-dog-contents'
    html_filename = @api.randomize_filename('index.html')
    html_body = 'stub-html-contents'

    post_file_data(@api, dog_image_filename, dog_image_body, 'image/png')
    post_file_data(@api, html_filename, html_body, 'text/html')

    # Verify that we download non-whitelisted file types as an attachment when
    # hitting the normal GET api.

    @api.get_object(dog_image_filename)
    assert successful?
    assert_nil last_response['Content-Disposition']

    @api.get_object(html_filename)
    assert successful?
    assert_equal "attachment; filename=\"#{html_filename}\"", last_response['Content-Disposition']

    # Verify that we download the files without Content-Disposition when hitting
    # the codeprojects.org root URL.

    @api.get_codeproject_object(dog_image_filename, '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert successful?
    assert_nil last_response['Content-Disposition']

    @api.get_codeproject_object(html_filename, '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert successful?
    assert_nil last_response['Content-Disposition']

    @api.delete_object(dog_image_filename)
    assert successful?

    @api.delete_object(html_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_codeprojects_get_deleted_project
    post_file_data(@api, 'index.html', '<div></div>', 'text/html')
    @api.get_codeproject_object('index.html', '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert successful?

    @api.delete_object('index.html')
    @api.get_codeproject_object('index.html', '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert not_found?

    delete_all_manifest_versions
  end

  def test_codeprojects_projects_url_get_deleted_project
    post_file_data(@api, 'index.html', '<div></div>', 'text/html')
    @api.get_codeproject_object('index.html', '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert successful?

    @api.delete_object('index.html')
    @api.get_codeproject_object('index.html', '', {'HTTP_HOST' => CDO.canonical_hostname('codeprojects.org')})
    assert not_found?

    delete_all_manifest_versions
  end

  def test_allow_mismatched_mime_type
    mismatched_filename = @api.randomize_filename('mismatchedmimetype.png')
    delete_all_file_versions(mismatched_filename)
    delete_all_manifest_versions

    post_file_data(@api, mismatched_filename, 'stub-contents', 'application/gif')
    assert successful?

    @api.delete_object(mismatched_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_escaping_insensitivity
    filename = @api.randomize_filename('has space.html')
    escaped_filename = filename.tr(' ', '-')
    filename2 = @api.randomize_filename('another has spaces.html')
    escaped_filename2 = filename2.tr(' ', '-')
    delete_all_file_versions(filename, escaped_filename, filename2, escaped_filename2)
    delete_all_manifest_versions

    post_file_data(@api, filename, 'stub-contents', 'test/html')
    assert successful?
    assert_equal escaped_filename, JSON.parse(last_response.body)['filename']

    @api.get_object(escaped_filename)
    assert successful?

    @api.delete_object(escaped_filename)
    assert successful?

    post_file_data(@api, escaped_filename2, 'stub-contents-2', 'test/html')
    assert successful?
    assert_equal escaped_filename2, JSON.parse(last_response.body)['filename']

    @api.get_object(escaped_filename2)
    assert successful?

    @api.delete_object(escaped_filename2)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_case_insensitivity
    filename = @api.randomize_filename('casesensitive.PNG')
    different_case_filename = filename.gsub(/PNG$/, 'png')
    delete_all_file_versions(filename, different_case_filename)
    delete_all_manifest_versions

    post_file_data(@api, filename, 'stub-contents', 'application/png')
    assert successful?

    @api.get_object(filename)
    assert successful?

    @api.get_object(different_case_filename)
    assert successful?

    @api.delete_object(different_case_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_nonexistent_file
    filename = @api.randomize_filename('nonexistent.png')
    dog_image_filename = @api.randomize_filename('dog.png')
    delete_all_file_versions(filename, dog_image_filename)
    delete_all_manifest_versions

    # Check for file when no manifest is present:
    @api.get_object(filename)
    assert not_found?

    dog_image_body = 'stub-dog-contents'
    post_file_data(@api, dog_image_filename, dog_image_body, 'image/png')
    assert successful?

    # Check again for file when another file is now present:
    @api.get_object(filename)
    assert not_found?

    @api.delete_object(dog_image_filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    delete_all_manifest_versions
  end

  def test_file_versions
    filename = @api.randomize_filename('test.png')
    delete_all_file_versions(filename)
    delete_all_manifest_versions

    # Create an animation file
    v1_file_data = 'stub-v1-body'
    post_file_data(@api, filename, v1_file_data, 'image/png')
    assert successful?

    # Overwrite it.
    v2_file_data = 'stub-v2-body'
    post_file_data(@api, filename, v2_file_data, 'image/png')
    assert successful?

    # Delete it.
    @api.delete_object(filename)
    assert successful?

    # List versions.
    versions = @api.list_object_versions(filename)
    assert successful?
    assert_equal 2, versions.count

    # Get the first and second version.
    assert_equal v1_file_data, @api.get_object_version(filename, versions[1]['versionId'])
    assert_equal v2_file_data, @api.get_object_version(filename, versions[0]['versionId'])

    # Check cache headers
    assert_match 'private, must-revalidate, max-age=0', last_response['Cache-Control']

    # List project versions.
    project_versions = @api.list_files_versions
    assert successful?
    assert_equal 3, project_versions.count
    assert project_versions[0]['isLatest']
    refute project_versions[1]['isLatest']
    refute project_versions[2]['isLatest']

    # View previous project version
    first_project_version = project_versions[2]['versionId']
    get "v3/files/#{@channel_id}?version=#{project_versions[2]['versionId']}"
    response_from_first_version = JSON.parse(last_response.body)
    # There should be only one file with filename, category, and size matching our expectations
    expected_file_info = {'filename' => filename, 'category' => 'image', 'size' => v1_file_data.length}
    file_infos = response_from_first_version['files']
    assert_equal(1, file_infos.length)
    assert_fileinfo_equal(expected_file_info, file_infos[0])
    # The version of the file should match our previous retrieval of that file version
    assert_equal(versions[1]['versionId'], file_infos[0]['versionId'])
    # The version of the project should match the one that we requested
    assert_equal(response_from_first_version['filesVersionId'], first_project_version)

    # Restore previous version
    @api.restore_files_version(first_project_version)
    assert successful?
    assert_equal v1_file_data, @api.get_object(filename)

    # Delete it.
    @api.delete_object(filename)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.list_versions
      Custom/ListRequests/FileBucket/BucketHelper.list_versions
    )

    delete_all_manifest_versions
  end

  def test_invalid_file_extension
    @api.get_object('bad_extension.css%22')
    assert unsupported_media_type?
    assert_newrelic_metrics []
  end

  def test_bad_channel_id
    bad_channel_id = 'undefined'
    api = FilesApiTestHelper.new(current_session, 'files', bad_channel_id)
    api.list_objects
    assert not_found?
    assert_newrelic_metrics []
  end

  def test_thumbnail
    thumbnail_filename = '.metadata/thumbnail.png'
    thumbnail_body = 'stub-dog-contents'

    @api.get_object(thumbnail_filename)
    assert not_found?

    @api.put_object(thumbnail_filename, thumbnail_body)
    assert successful?

    assert_equal thumbnail_body, @api.get_object(thumbnail_filename)

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(thumbnail_filename)
    assert successful?

    @api.get_object(thumbnail_filename)
    assert not_found?
  end

  def test_metadata_auth
    thumbnail_filename = '.metadata/thumbnail.png'
    thumbnail_body = 'stub-thumbnail-contents'
    other_body = 'stub-other-contents'

    @api.get_object(thumbnail_filename)
    assert not_found?

    @api.put_object(thumbnail_filename, thumbnail_body)
    assert successful?

    with_session(:non_owner) do
      non_owner_api = FilesApiTestHelper.new(current_session, 'files', @channel_id)

      # non-owner can view
      assert_equal thumbnail_body, non_owner_api.get_object(thumbnail_filename)

      # non-owner cannot put
      non_owner_api.put_object(thumbnail_filename, other_body)
      refute successful?

      # non-owner cannot delete
      non_owner_api.delete_object(thumbnail_filename)
      refute successful?
    end

    # file contents has not changed
    assert_equal thumbnail_body, @api.get_object(thumbnail_filename)

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(thumbnail_filename)
    assert successful?

    @api.get_object(thumbnail_filename)
    assert not_found?
  end

  def test_bogus_metadata
    bogus_metadata_filename = '.metadata/bogus.png'
    bogus_metadata_body = 'stub-bogus-metadata-contents'

    @api.get_object(bogus_metadata_filename)
    assert not_found?

    @api.put_object(bogus_metadata_filename, bogus_metadata_body)
    assert bad_request?

    @api.get_object(bogus_metadata_filename)
    assert not_found?

    @api.delete_object(bogus_metadata_filename)
    assert bad_request?

    @api.get_object(bogus_metadata_filename)
    assert not_found?

    assert_newrelic_metrics []
  end

  def test_rename_mixed_case
    filename = @api.randomize_filename('Mixed Case With Spaces.html')
    escaped_filename = filename.tr(' ', '-')
    filename2 = @api.randomize_filename('Another Mixed Case Spaces Name.html')
    escaped_filename2 = filename2.tr(' ', '-')
    delete_all_file_versions(filename, filename2)
    delete_all_manifest_versions

    post_file_data(@api, filename, 'stub-contents', 'test/html')
    assert successful?
    assert_equal escaped_filename, JSON.parse(last_response.body)['filename']

    @api.get_object(escaped_filename)
    assert successful?
    assert_equal 'stub-contents', last_response.body

    @api.rename_object(escaped_filename, escaped_filename2)
    assert successful?

    @api.get_object(escaped_filename2)
    assert successful?
    assert_equal 'stub-contents', last_response.body

    @api.get_object(escaped_filename)
    assert not_found?

    @api.delete_object(escaped_filename2)
    assert successful?

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.object_and_app_size
    )

    delete_all_manifest_versions
  end

  def test_rename_case_only
    filename = @api.randomize_filename('Mixed Case With Spaces.png')
    escaped_filename = filename.tr(' ', '-')
    filename2 = filename.sub 'Mixed Case', 'mixeD casE'
    escaped_filename2 = filename2.tr(' ', '-')
    delete_all_file_versions filename, filename2
    delete_all_manifest_versions

    image_body = 'stub-image-contents'

    post_file_data(@api, filename, image_body, 'image/png')
    assert successful?
    assert_equal escaped_filename, JSON.parse(last_response.body)['filename']

    @api.get_object(escaped_filename)
    assert successful?
    assert_equal image_body, last_response.body

    @api.get_object(escaped_filename2)
    assert successful?
    assert_equal image_body, last_response.body

    get "v3/files/#{@channel_id}"
    response_before_rename = JSON.parse(last_response.body)
    # There should be only one file with filename, category, and size matching our expectations
    expected_image_info = {'filename' => escaped_filename, 'category' => 'image', 'size' => image_body.length}
    file_infos = response_before_rename['files']
    assert_equal(1, file_infos.length)
    assert_fileinfo_equal(expected_image_info, file_infos[0])

    @api.rename_object(escaped_filename, escaped_filename2)
    assert successful?

    @api.get_object(escaped_filename)
    assert successful?
    assert_equal image_body, last_response.body

    @api.get_object(escaped_filename2)
    assert successful?
    assert_equal image_body, last_response.body

    get "v3/files/#{@channel_id}"
    response_after_rename = JSON.parse(last_response.body)
    # There should be only one file with the new filename, category, and size matching our expectations
    expected_image_info_after_rename = {'filename' => escaped_filename2, 'category' => 'image', 'size' => image_body.length}
    file_infos_after_rename = response_after_rename['files']
    assert_equal(1, file_infos_after_rename.length)
    assert_fileinfo_equal(expected_image_info_after_rename, file_infos_after_rename[0])

    # The manifest version (filesVersionId) should be different, but the file version should be the same
    refute_equal response_before_rename['filesVersionId'], response_after_rename['filesVersionId']
    assert_equal file_infos[0]['versionId'], file_infos_after_rename[0]['versionId']

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(escaped_filename2)
    assert successful?

    delete_all_manifest_versions
  end

  def test_files_copy_all
    # This test creates 2 channels
    delete_all_files('files_test/1/2')
    dest_channel_id = create_channel
    src_api = FilesApiTestHelper.new(current_session, 'files', @channel_id)
    dest_api = FilesApiTestHelper.new(current_session, 'files', dest_channel_id)

    image_filename = @api.randomize_filename('Cat.jpg')
    image_body = 'stub-image-contents'

    sound_filename = @api.randomize_filename('Woof Woof.mp3')
    escaped_sound_filename = sound_filename.tr(' ', '-')
    sound_body = 'stub-sound-contents'

    post_file_data(src_api, image_filename, image_body, 'image/jpeg')
    assert_equal image_filename, JSON.parse(last_response.body)['filename']

    post_file_data(src_api, sound_filename, sound_body, 'audio/mpeg')
    assert_equal escaped_sound_filename, JSON.parse(last_response.body)['filename']

    # Can't test abuse score functionality, since it's been moved to Rails.
    #src_api.patch_abuse(10)

    expected_image_info = {'filename' =>  image_filename, 'category' => 'image', 'size' => image_body.length}
    expected_sound_info = {'filename' =>  escaped_sound_filename, 'category' => 'audio', 'size' => sound_body.length}

    copy_file_infos = JSON.parse(copy_all(@channel_id, dest_channel_id))
    dest_file_infos = dest_api.list_objects["files"]

    assert_fileinfo_equal(expected_image_info, copy_file_infos[0])
    assert_fileinfo_equal(expected_sound_info, copy_file_infos[1])
    assert_fileinfo_equal(expected_image_info, dest_file_infos[0])
    assert_fileinfo_equal(expected_sound_info, dest_file_infos[1])

    dest_api.get_object(CGI.escape(image_filename))
    assert successful?
    assert_equal image_body, last_response.body

    dest_api.get_object(escaped_sound_filename)
    assert successful?
    assert_equal sound_body, last_response.body

    # abuse score didn't carry over
    # note: these assertions aren't verifying anything, since the abuse score functionality
    # got moved to Rails, so we can't actually increase the abuse score in this test.
    assert_equal 0, FileBucket.new.get_abuse_score(dest_channel_id, CGI.escape(image_filename.downcase))
    assert_equal 0, FileBucket.new.get_abuse_score(dest_channel_id, escaped_sound_filename.downcase)

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.app_size
      Custom/ListRequests/FileBucket/BucketHelper.copy_files
    )

    src_api.delete_object(CGI.escape(image_filename))
    src_api.delete_object(CGI.escape(escaped_sound_filename))
    delete_all_manifest_versions
    dest_api.delete_object(CGI.escape(image_filename))
    dest_api.delete_object(CGI.escape(escaped_sound_filename))
    delete_channel(dest_channel_id)
  end

  def test_temporary_public_url
    thumbnail_filename = '.metadata/thumbnail.png'
    thumbnail_body = 'stub-thumbnail-contents'

    @api.put_object(thumbnail_filename, thumbnail_body)
    assert successful?

    temp_url = FileBucket.new.make_temporary_public_url(@channel_id, thumbnail_filename)

    # Links to the right file
    assert_includes temp_url, 'cdo-v3-files.s3.amazonaws.com/files_test/1/1/.metadata/thumbnail.png'

    # Has a 5-minute timeout by default
    assert_includes temp_url, 'X-Amz-Expires=300'

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(thumbnail_filename)
    assert successful?
  end

  def test_temporary_public_url_with_custom_timeout
    thumbnail_filename = '.metadata/thumbnail.png'
    thumbnail_body = 'stub-thumbnail-contents'

    @api.put_object(thumbnail_filename, thumbnail_body)
    assert successful?

    temp_url = FileBucket.new.make_temporary_public_url(@channel_id, thumbnail_filename, 1.hour)

    # Links to the right file
    assert_includes temp_url, 'cdo-v3-files.s3.amazonaws.com/files_test/1/1/.metadata/thumbnail.png'

    # Has a 5-minute timeout by default
    assert_includes temp_url, 'X-Amz-Expires=3600'

    assert_newrelic_metrics %w(
      Custom/ListRequests/FileBucket/BucketHelper.app_size
    )

    @api.delete_object(thumbnail_filename)
    assert successful?
  end

  private

  def delete_all_files(bucket)
    delete_all_objects(CDO.files_s3_bucket, bucket)
  end

  def copy_all(src_channel_id, dest_channel_id)
    FileBucket.new.copy_files(src_channel_id, dest_channel_id).to_json
  end

  def post_file(api, uploaded_file)
    body = {files: [uploaded_file]}
    headers = {'CONTENT_TYPE' => 'multipart/form-data'}
    api.post_object '', body, headers
  end

  def post_file_data(api, filename, file_contents, content_type)
    file = api.create_uploaded_file(filename, file_contents, content_type)
    post_file(api, file)
  end

  def delete_all_file_versions(*filenames)
    filenames.each do |filename|
      delete_all_versions(CDO.files_s3_bucket, "files_test/1/1/#{filename}")
    end
  end

  def delete_all_manifest_versions
    delete_all_file_versions 'manifest.json'
  end
end
